/* =========================================================
   BAT RAT — منطق التطبيق
   يعتمد على Supabase (Auth + Database + Storage + Realtime)
   ========================================================= */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  user: null,
  profile: null,
  currentCommunity: null,
  currentChatUser: null,
  conversationsCache: [],
  viewingProfile: null,
  realtimeChannel: null,
};

/* ---------------------------- أدوات مساعدة ---------------------------- */

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return document.querySelectorAll(sel); }

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[c]));
}

function defaultAvatarDataUri() {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#1E242C"/>' +
    '<circle cx="50" cy="38" r="18" fill="#2A323D"/>' +
    '<rect x="20" y="62" width="60" height="30" rx="15" fill="#2A323D"/>' +
    '</svg>'
  );
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('ar', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  } catch (e) { return ''; }
}

function updateCountSpan(span, delta) {
  if (!span) return;
  span.textContent = (parseInt(span.textContent || '0', 10) + delta);
}

function showToast(message, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function showAuthMessage(msg, type) {
  const el = $('#auth-message');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.toggle('info', type === 'info');
}

function translateAuthError(msg) {
  if (/Invalid login credentials/i.test(msg)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (/Email not confirmed/i.test(msg)) return 'يجب تأكيد البريد الإلكتروني أولًا، أو عطّل "Confirm email" من إعدادات Supabase للتجربة السريعة (راجع README).';
  if (/User already registered/i.test(msg)) return 'هذا البريد الإلكتروني مسجّل بالفعل.';
  return msg;
}

function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModal(id) { $('#' + id).classList.add('hidden'); }

function showSection(name) {
  $all('.view-section').forEach((s) => s.classList.remove('active'));
  $('#section-' + name).classList.add('active');
}

/* ---------------------------- تبديل العروض ---------------------------- */

function switchView(name) {
  showSection(name);
  $all('.nav-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'feed') loadFeed();
  if (name === 'communities') loadCommunities();
  if (name === 'messages') loadConversations();
  if (name === 'profile') { renderMyProfileHeader(); loadMyPosts(); }
}

/* ---------------------------- المصادقة ---------------------------- */

function showAuth() {
  $('#view-auth').classList.remove('hidden');
  $('#view-app').classList.add('hidden');
}

function showApp() {
  $('#view-auth').classList.add('hidden');
  $('#view-app').classList.remove('hidden');
  setupRealtimeMessages();
  switchView('feed');
}

function setAuthTab(tab) {
  $all('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#form-login').classList.toggle('active', tab === 'login');
  $('#form-signup').classList.toggle('active', tab === 'signup');
  $('#auth-message').classList.add('hidden');
}

async function loadMyProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', state.user.id).single();
  if (error) { console.error(error); return; }
  state.profile = data;
}

async function handleLogin(e) {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  const btn = $('#btn-login-submit');
  btn.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) { showAuthMessage(translateAuthError(error.message), 'error'); return; }
  state.user = data.user;
  await loadMyProfile();
  if (!state.profile) {
    showAuthMessage('تم تسجيل الدخول لكن لا يوجد ملف شخصي مرتبط بهذا الحساب.', 'error');
    return;
  }
  showApp();
}

async function handleSignup(e) {
  e.preventDefault();
  const username = $('#signup-username').value.trim().toLowerCase();
  const displayName = $('#signup-displayname').value.trim();
  const email = $('#signup-email').value.trim();
  const password = $('#signup-password').value;
  const btn = $('#btn-signup-submit');
  btn.disabled = true;

  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) {
    btn.disabled = false;
    showAuthMessage(translateAuthError(error.message), 'error');
    return;
  }

  if (!data.session) {
    btn.disabled = false;
    showAuthMessage('تم إنشاء الحساب! إذا كان تأكيد البريد مفعّلاً في مشروعك، تحقق من بريدك الإلكتروني ثم سجّل الدخول. للتجربة الفورية بدون بريد، عطّل "Confirm email" من إعدادات Supabase (راجع README.md).', 'info');
    $('#login-email').value = email;
    setAuthTab('login');
    return;
  }

  state.user = data.user;
  const { error: profileError } = await sb.from('profiles').insert({
    id: data.user.id, username, display_name: displayName, bio: '',
  });
  btn.disabled = false;
  if (profileError) {
    showAuthMessage('تم إنشاء حساب الدخول، لكن فشل إنشاء الملف الشخصي: ' + profileError.message + ' (قد يكون اسم المستخدم مستخدمًا من قبل، جرّب اسمًا آخر وسجّل الدخول).', 'error');
    return;
  }
  await loadMyProfile();
  showApp();
  showToast('أهلًا بك في BAT RAT 🦇', 'success');
}

async function handleLogout() {
  await sb.auth.signOut();
  if (state.realtimeChannel) { sb.removeChannel(state.realtimeChannel); state.realtimeChannel = null; }
  state.user = null;
  state.profile = null;
  showAuth();
}

/* ---------------------------- رفع الصور ---------------------------- */

async function uploadImage(file, bucket) {
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${state.user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await sb.storage.from(bucket).upload(path, file);
    if (error) { showToast('فشل رفع الصورة: ' + error.message, 'error'); return null; }
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    showToast('فشل رفع الصورة.', 'error');
    return null;
  }
}

/* ---------------------------- المنشورات: عرض ---------------------------- */

async function attachEngagement(posts) {
  if (!posts || !posts.length) return posts;
  const ids = posts.map((p) => p.id);
  const [likesRes, commentsRes] = await Promise.all([
    sb.from('likes').select('post_id,user_id').in('post_id', ids),
    sb.from('comments').select('post_id').in('post_id', ids),
  ]);
  const likeCounts = {}; const myLikes = new Set(); const commentCounts = {};
  (likesRes.data || []).forEach((l) => {
    likeCounts[l.post_id] = (likeCounts[l.post_id] || 0) + 1;
    if (l.user_id === state.user.id) myLikes.add(l.post_id);
  });
  (commentsRes.data || []).forEach((c) => {
    commentCounts[c.post_id] = (commentCounts[c.post_id] || 0) + 1;
  });
  posts.forEach((p) => {
    p.likes_count = likeCounts[p.id] || 0;
    p.liked_by_me = myLikes.has(p.id);
    p.comments_count = commentCounts[p.id] || 0;
  });
  return posts;
}

function postCardHtml(p) {
  const author = p.profiles || {};
  const avatarUrl = author.avatar_url || defaultAvatarDataUri();
  const mine = p.author_id === state.user.id;
  return `
  <article class="post-card" data-post-id="${p.id}">
    <div class="post-head">
      <img class="avatar avatar-sm" src="${escapeHtml(avatarUrl)}" alt="">
      <div class="post-author">
        <button type="button" class="post-author-name" data-username="${escapeHtml(author.username || '')}">${escapeHtml(author.display_name || 'مستخدم')}</button>
        <span class="post-time">${formatTime(p.created_at)}${p.community_id ? ' <span class="post-community-tag">• مجتمع</span>' : ''}</span>
      </div>
      ${mine ? `<button type="button" class="btn-danger-text post-delete" data-action="delete-post" data-post-id="${p.id}">حذف</button>` : ''}
    </div>
    <p class="post-content">${escapeHtml(p.content)}</p>
    ${p.image_url ? `<img class="post-image" src="${escapeHtml(p.image_url)}" alt="">` : ''}
    <div class="post-actions">
      <button type="button" class="btn-like ${p.liked_by_me ? 'liked' : ''}" data-action="toggle-like" data-post-id="${p.id}">🦇 <span class="like-count">${p.likes_count || 0}</span></button>
      <button type="button" class="btn-comment-toggle" data-action="toggle-comments" data-post-id="${p.id}">💬 <span class="comment-count">${p.comments_count || 0}</span></button>
    </div>
    <div class="comments-box hidden" data-comments-for="${p.id}">
      <div class="comments-list"></div>
      <form class="form-add-comment" data-post-id="${p.id}">
        <input type="text" maxlength="300" placeholder="أضف تعليقًا…" required>
        <button type="submit" class="btn btn-ghost">إرسال</button>
      </form>
    </div>
  </article>`;
}

function renderPostList(posts, container) {
  container.innerHTML = posts.map(postCardHtml).join('');
}

async function loadFeed() {
  const loading = $('#feed-loading');
  loading.classList.remove('hidden');
  const { data, error } = await sb.from('posts')
    .select('*, profiles(username,display_name,avatar_url)')
    .is('community_id', null)
    .order('created_at', { ascending: false })
    .limit(50);
  loading.classList.add('hidden');
  if (error) { showToast('فشل تحميل المنشورات: ' + error.message, 'error'); return; }
  await attachEngagement(data);
  renderPostList(data, $('#feed-list'));
  $('#feed-empty').classList.toggle('hidden', data.length > 0);
}

async function handleCreatePost(e) {
  e.preventDefault();
  const textarea = $('#post-content');
  const content = textarea.value.trim();
  if (!content) return;
  const fileInput = $('#post-image');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  let imageUrl = null;
  if (fileInput.files[0]) {
    imageUrl = await uploadImage(fileInput.files[0], 'posts');
    if (imageUrl === null) { submitBtn.disabled = false; return; }
  }
  const { data, error } = await sb.from('posts')
    .insert({ author_id: state.user.id, content, image_url: imageUrl, community_id: null })
    .select('*, profiles(username,display_name,avatar_url)')
    .single();
  submitBtn.disabled = false;
  if (error) { showToast('فشل النشر: ' + error.message, 'error'); return; }
  data.likes_count = 0; data.liked_by_me = false; data.comments_count = 0;
  $('#feed-list').insertAdjacentHTML('afterbegin', postCardHtml(data));
  $('#feed-empty').classList.add('hidden');
  e.target.reset();
  $('#post-image-name').textContent = '';
  showToast('تم النشر 🦇', 'success');
}

async function handleToggleLike(btn) {
  const postId = btn.dataset.postId;
  const liked = btn.classList.contains('liked');
  if (liked) {
    const { error } = await sb.from('likes').delete().eq('post_id', postId).eq('user_id', state.user.id);
    if (error) return showToast(error.message, 'error');
    btn.classList.remove('liked');
    updateCountSpan(btn.querySelector('.like-count'), -1);
  } else {
    const { error } = await sb.from('likes').insert({ post_id: postId, user_id: state.user.id });
    if (error) return showToast(error.message, 'error');
    btn.classList.add('liked');
    updateCountSpan(btn.querySelector('.like-count'), 1);
  }
}

async function handleDeletePost(btn) {
  if (!confirm('حذف هذا المنشور؟')) return;
  const postId = btn.dataset.postId;
  const { error } = await sb.from('posts').delete().eq('id', postId);
  if (error) return showToast(error.message, 'error');
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (card) card.remove();
  showToast('تم حذف المنشور', 'success');
}

async function handleToggleComments(btn) {
  const postId = btn.dataset.postId;
  const box = document.querySelector(`[data-comments-for="${postId}"]`);
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden') && !box.dataset.loaded) {
    await loadComments(postId, box);
    box.dataset.loaded = '1';
  }
}

async function loadComments(postId, box) {
  const { data, error } = await sb.from('comments')
    .select('*, profiles(display_name)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) return showToast(error.message, 'error');
  const list = box.querySelector('.comments-list');
  list.innerHTML = data.length
    ? data.map((c) => `<div class="comment-item"><span class="comment-author">${escapeHtml(c.profiles ? c.profiles.display_name : 'مستخدم')}:</span> ${escapeHtml(c.content)}</div>`).join('')
    : '<p class="muted" style="font-size:.8rem">لا تعليقات بعد.</p>';
}

async function handleAddComment(form) {
  const postId = form.dataset.postId;
  const input = form.querySelector('input');
  const content = input.value.trim();
  if (!content) return;
  const { data, error } = await sb.from('comments')
    .insert({ post_id: postId, author_id: state.user.id, content })
    .select('*, profiles(display_name)')
    .single();
  if (error) return showToast(error.message, 'error');
  input.value = '';
  const box = document.querySelector(`[data-comments-for="${postId}"]`);
  const list = box.querySelector('.comments-list');
  const emptyMsg = list.querySelector('.muted');
  if (emptyMsg) list.innerHTML = '';
  list.insertAdjacentHTML('beforeend', `<div class="comment-item"><span class="comment-author">${escapeHtml(data.profiles ? data.profiles.display_name : state.profile.display_name)}:</span> ${escapeHtml(data.content)}</div>`);
  const countSpan = document.querySelector(`.post-card[data-post-id="${postId}"] .comment-count`);
  updateCountSpan(countSpan, 1);
}

/* ---------------------------- المجتمعات ---------------------------- */

async function loadCommunities() {
  $('#communities-loading').classList.remove('hidden');
  const { data: communities, error } = await sb.from('communities').select('*').order('created_at', { ascending: false });
  $('#communities-loading').classList.add('hidden');
  if (error) { showToast('فشل تحميل المجتمعات: ' + error.message, 'error'); return; }

  const { data: myMemberships } = await sb.from('community_members').select('community_id').eq('user_id', state.user.id);
  const myIds = new Set((myMemberships || []).map((m) => m.community_id));

  const { data: allMembers } = await sb.from('community_members').select('community_id');
  const counts = {};
  (allMembers || []).forEach((m) => { counts[m.community_id] = (counts[m.community_id] || 0) + 1; });

  $('#communities-list').innerHTML = communities.map((c) => `
    <div class="community-card">
      <h4>${escapeHtml(c.name)}</h4>
      <p class="muted">${escapeHtml(c.description || '')}</p>
      <div class="community-card-footer">
        <span class="member-count">${counts[c.id] || 0} عضو</span>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn btn-ghost" data-action="open-community" data-community-id="${c.id}">عرض</button>
          ${myIds.has(c.id)
            ? `<button type="button" class="btn btn-secondary" data-action="leave-community" data-community-id="${c.id}">عضو ✓</button>`
            : `<button type="button" class="btn btn-primary" data-action="join-community" data-community-id="${c.id}">انضمام</button>`}
        </div>
      </div>
    </div>`).join('');
  $('#communities-empty').classList.toggle('hidden', communities.length > 0);
}

async function handleCreateCommunitySubmit(e) {
  e.preventDefault();
  const name = $('#community-name').value.trim();
  const description = $('#community-description').value.trim();
  const { data, error } = await sb.from('communities').insert({ name, description, creator_id: state.user.id }).select().single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) showToast('يوجد مجتمع بهذا الاسم بالفعل، اختر اسمًا آخر.', 'error');
    else showToast('فشل إنشاء المجتمع: ' + error.message, 'error');
    return;
  }
  await sb.from('community_members').insert({ community_id: data.id, user_id: state.user.id, role: 'admin' });
  closeModal('modal-create-community');
  e.target.reset();
  showToast('تم إنشاء المجتمع 🎉', 'success');
  loadCommunities();
}

async function handleJoinCommunity(btn) {
  const id = btn.dataset.communityId;
  const { error } = await sb.from('community_members').insert({ community_id: id, user_id: state.user.id });
  if (error) return showToast('فشل الانضمام: ' + error.message, 'error');
  showToast('انضممت إلى المجتمع 🦇', 'success');
  loadCommunities();
  if (state.currentCommunity === id) openCommunity(id);
}

async function handleLeaveCommunity(btn) {
  const id = btn.dataset.communityId;
  const { error } = await sb.from('community_members').delete().eq('community_id', id).eq('user_id', state.user.id);
  if (error) return showToast('فشل: ' + error.message, 'error');
  showToast('غادرت المجتمع', 'info');
  loadCommunities();
  if (state.currentCommunity === id) openCommunity(id);
}

async function openCommunity(id) {
  state.currentCommunity = id;
  showSection('community-detail');
  const { data: community, error } = await sb.from('communities').select('*').eq('id', id).single();
  if (error) { showToast(error.message, 'error'); return; }
  const { data: membership } = await sb.from('community_members').select('id').eq('community_id', id).eq('user_id', state.user.id).maybeSingle();
  const { count } = await sb.from('community_members').select('id', { count: 'exact', head: true }).eq('community_id', id);

  $('#community-header').innerHTML = `
    <div>
      <h2>${escapeHtml(community.name)}</h2>
      <p class="muted">${escapeHtml(community.description || '')}</p>
      <p class="member-count">${count || 0} عضو</p>
    </div>
    ${membership
      ? `<button type="button" class="btn btn-secondary" data-action="leave-community" data-community-id="${id}">مغادرة المجتمع</button>`
      : `<button type="button" class="btn btn-primary" data-action="join-community" data-community-id="${id}">انضمام للمجتمع</button>`}
  `;
  $('#community-composer').classList.toggle('hidden', !membership);
  loadCommunityPosts(id);
}

async function loadCommunityPosts(id) {
  const { data, error } = await sb.from('posts')
    .select('*, profiles(username,display_name,avatar_url)')
    .eq('community_id', id)
    .order('created_at', { ascending: false });
  if (error) { showToast(error.message, 'error'); return; }
  await attachEngagement(data);
  renderPostList(data, $('#community-posts-list'));
  $('#community-posts-empty').classList.toggle('hidden', data.length > 0);
}

async function handleCreateCommunityPost(e) {
  e.preventDefault();
  if (!state.currentCommunity) return;
  const textarea = $('#community-post-content');
  const content = textarea.value.trim();
  if (!content) return;
  const fileInput = $('#community-post-image');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  let imageUrl = null;
  if (fileInput.files[0]) {
    imageUrl = await uploadImage(fileInput.files[0], 'posts');
    if (imageUrl === null) { submitBtn.disabled = false; return; }
  }
  const { data, error } = await sb.from('posts')
    .insert({ author_id: state.user.id, content, image_url: imageUrl, community_id: state.currentCommunity })
    .select('*, profiles(username,display_name,avatar_url)')
    .single();
  submitBtn.disabled = false;
  if (error) { showToast('فشل النشر: ' + error.message, 'error'); return; }
  data.likes_count = 0; data.liked_by_me = false; data.comments_count = 0;
  $('#community-posts-list').insertAdjacentHTML('afterbegin', postCardHtml(data));
  $('#community-posts-empty').classList.add('hidden');
  e.target.reset();
  $('#community-post-image-name').textContent = '';
  showToast('تم النشر في المجتمع 🦇', 'success');
}

/* ---------------------------- الرسائل ---------------------------- */

async function loadConversations() {
  const { data, error } = await sb.from('messages')
    .select('*')
    .or(`sender_id.eq.${state.user.id},receiver_id.eq.${state.user.id}`)
    .order('created_at', { ascending: false });
  if (error) { showToast('فشل تحميل المحادثات: ' + error.message, 'error'); return; }

  const map = new Map();
  (data || []).forEach((m) => {
    const otherId = m.sender_id === state.user.id ? m.receiver_id : m.sender_id;
    if (!map.has(otherId)) {
      map.set(otherId, { otherId, lastMessage: m, unread: (m.receiver_id === state.user.id && !m.is_read) ? 1 : 0 });
    } else if (m.receiver_id === state.user.id && !m.is_read) {
      map.get(otherId).unread += 1;
    }
  });

  const otherIds = [...map.keys()];
  if (otherIds.length) {
    const { data: profiles } = await sb.from('profiles').select('id,username,display_name,avatar_url').in('id', otherIds);
    (profiles || []).forEach((p) => { if (map.has(p.id)) map.get(p.id).profile = p; });
  }

  state.conversationsCache = [...map.values()].sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
  renderConversations();
  updateUnreadBadge();
}

function renderConversations() {
  const convos = state.conversationsCache;
  $('#conversations-list').innerHTML = convos.map((c) => {
    const p = c.profile || {};
    return `
    <li class="conversation-item ${state.currentChatUser && state.currentChatUser.id === c.otherId ? 'active' : ''}"
        data-user-id="${c.otherId}" data-username="${escapeHtml(p.username || '')}"
        data-displayname="${escapeHtml(p.display_name || 'مستخدم')}" data-avatar="${escapeHtml(p.avatar_url || '')}">
      <img class="avatar avatar-sm" src="${escapeHtml(p.avatar_url || defaultAvatarDataUri())}" alt="">
      <div class="conversation-text">
        <div class="conversation-name">${escapeHtml(p.display_name || 'مستخدم')}</div>
        <div class="conversation-preview">${escapeHtml(c.lastMessage.content)}</div>
      </div>
      ${c.unread > 0 ? '<span class="unread-dot"></span>' : ''}
    </li>`;
  }).join('');
  $('#conversations-empty').classList.toggle('hidden', convos.length > 0);
}

function updateUnreadBadge() {
  const total = state.conversationsCache.reduce((s, c) => s + c.unread, 0);
  $('#badge-unread').classList.toggle('hidden', total === 0);
}

async function openConversation(userId, username, displayName, avatar) {
  state.currentChatUser = { id: userId, username, displayName, avatar };
  $('#chat-empty').classList.add('hidden');
  $('#chat-active').classList.remove('hidden');
  $('#chat-header').innerHTML = `<img class="avatar avatar-sm" src="${escapeHtml(avatar || defaultAvatarDataUri())}" alt=""><span>${escapeHtml(displayName)}</span>`;
  renderConversations();
  await loadMessages(userId);
  await markMessagesRead(userId);
}

async function loadMessages(otherId) {
  const { data, error } = await sb.from('messages')
    .select('*')
    .or(`and(sender_id.eq.${state.user.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${state.user.id})`)
    .order('created_at', { ascending: true });
  if (error) { showToast(error.message, 'error'); return; }
  const container = $('#chat-messages');
  container.innerHTML = data.map((m) => `
    <div class="msg-bubble ${m.sender_id === state.user.id ? 'msg-mine' : 'msg-theirs'}">${escapeHtml(m.content)}<span class="msg-time">${formatTime(m.created_at)}</span></div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

function appendMessageBubble(m, mine) {
  const container = $('#chat-messages');
  container.insertAdjacentHTML('beforeend', `<div class="msg-bubble ${mine ? 'msg-mine' : 'msg-theirs'}">${escapeHtml(m.content)}<span class="msg-time">${formatTime(m.created_at)}</span></div>`);
  container.scrollTop = container.scrollHeight;
}

async function markMessagesRead(otherId) {
  await sb.from('messages').update({ is_read: true }).eq('sender_id', otherId).eq('receiver_id', state.user.id).eq('is_read', false);
  loadConversations();
}

async function handleSendMessage(e) {
  e.preventDefault();
  if (!state.currentChatUser) return;
  const input = $('#message-input');
  const content = input.value.trim();
  if (!content) return;
  const { data, error } = await sb.from('messages')
    .insert({ sender_id: state.user.id, receiver_id: state.currentChatUser.id, content })
    .select().single();
  if (error) return showToast(error.message, 'error');
  input.value = '';
  appendMessageBubble(data, true);
  loadConversations();
}

function setupRealtimeMessages() {
  if (state.realtimeChannel) { sb.removeChannel(state.realtimeChannel); state.realtimeChannel = null; }
  state.realtimeChannel = sb.channel('messages-listen-' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${state.user.id}` }, (payload) => {
      const m = payload.new;
      if (state.currentChatUser && state.currentChatUser.id === m.sender_id) {
        appendMessageBubble(m, false);
        markMessagesRead(m.sender_id);
      } else {
        showToast('رسالة جديدة 📩', 'info');
        loadConversations();
      }
    })
    .subscribe();
}

/* ---------------------------- البحث والملف الشخصي العام ---------------------------- */

async function handleSearchUser(e) {
  e.preventDefault();
  const input = $('#search-username');
  const username = input.value.trim().toLowerCase().replace(/^@/, '');
  if (!username) return;
  const { data, error } = await sb.from('profiles').select('*').eq('username', username).maybeSingle();
  if (error || !data) { showToast('لم يتم العثور على هذا المستخدم.', 'error'); return; }
  input.value = '';
  openPublicProfile(data);
}

async function openPublicProfile(profile) {
  if (profile.id === state.user.id) { switchView('profile'); return; }
  state.viewingProfile = profile;
  showSection('public-profile');
  $('#public-avatar').src = profile.avatar_url || defaultAvatarDataUri();
  $('#public-displayname').textContent = profile.display_name;
  $('#public-username').textContent = '@' + profile.username;
  $('#public-bio').textContent = profile.bio || '';
  const { data: posts, error } = await sb.from('posts')
    .select('*, profiles(username,display_name,avatar_url)')
    .eq('author_id', profile.id)
    .order('created_at', { ascending: false });
  if (error) return showToast(error.message, 'error');
  await attachEngagement(posts);
  renderPostList(posts, $('#public-posts-list'));
  $('#public-posts-empty').classList.toggle('hidden', posts.length > 0);
}

async function openPublicProfileByUsername(username) {
  const { data, error } = await sb.from('profiles').select('*').eq('username', username).maybeSingle();
  if (error || !data) { showToast('المستخدم غير موجود.', 'error'); return; }
  openPublicProfile(data);
}

async function goToConversationWith(profile) {
  showSection('messages');
  $all('.nav-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === 'messages'));
  await loadConversations();
  openConversation(profile.id, profile.username, profile.display_name, profile.avatar_url);
}

/* ---------------------------- ملفي الشخصي ---------------------------- */

function renderMyProfileHeader() {
  if (!state.profile) return;
  $('#my-avatar').src = state.profile.avatar_url || defaultAvatarDataUri();
  $('#my-displayname').textContent = state.profile.display_name;
  $('#my-username').textContent = '@' + state.profile.username;
  $('#edit-displayname').value = state.profile.display_name;
  $('#edit-bio').value = state.profile.bio || '';
}

async function loadMyPosts() {
  const { data, error } = await sb.from('posts')
    .select('*, profiles(username,display_name,avatar_url)')
    .eq('author_id', state.user.id)
    .order('created_at', { ascending: false });
  if (error) return showToast(error.message, 'error');
  await attachEngagement(data);
  renderPostList(data, $('#my-posts-list'));
  $('#my-posts-empty').classList.toggle('hidden', data.length > 0);
}

async function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const url = await uploadImage(file, 'avatars');
  if (!url) return;
  const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', state.user.id);
  if (error) return showToast(error.message, 'error');
  state.profile.avatar_url = url;
  $('#my-avatar').src = url;
  showToast('تم تحديث صورتك', 'success');
}

async function handleEditProfile(e) {
  e.preventDefault();
  const displayName = $('#edit-displayname').value.trim();
  const bio = $('#edit-bio').value.trim();
  const { error } = await sb.from('profiles').update({ display_name: displayName, bio }).eq('id', state.user.id);
  if (error) return showToast(error.message, 'error');
  state.profile.display_name = displayName;
  state.profile.bio = bio;
  $('#my-displayname').textContent = displayName;
  showToast('تم حفظ التعديلات', 'success');
}

/* ---------------------------- ربط الأحداث ---------------------------- */

function bindStaticEvents() {
  $('#btn-show-login').addEventListener('click', () => setAuthTab('login'));
  $('#btn-show-signup').addEventListener('click', () => setAuthTab('signup'));
  $('#form-login').addEventListener('submit', handleLogin);
  $('#form-signup').addEventListener('submit', handleSignup);
  $('#btn-logout').addEventListener('click', handleLogout);

  $all('.nav-tab').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));

  $('#form-create-post').addEventListener('submit', handleCreatePost);
  $('#post-image').addEventListener('change', (e) => { $('#post-image-name').textContent = e.target.files[0] ? e.target.files[0].name : ''; });

  $('#btn-open-create-community').addEventListener('click', () => openModal('modal-create-community'));
  $('#form-create-community').addEventListener('submit', handleCreateCommunitySubmit);
  $('#btn-back-communities').addEventListener('click', () => switchView('communities'));
  $('#form-create-community-post').addEventListener('submit', handleCreateCommunityPost);
  $('#community-post-image').addEventListener('change', (e) => { $('#community-post-image-name').textContent = e.target.files[0] ? e.target.files[0].name : ''; });

  $('#form-search-user').addEventListener('submit', handleSearchUser);

  $('#form-send-message').addEventListener('submit', handleSendMessage);

  $('#avatar-input').addEventListener('change', handleAvatarUpload);
  $('#form-edit-profile').addEventListener('submit', handleEditProfile);

  $('#btn-back-from-public').addEventListener('click', () => switchView('feed'));
  $('#btn-message-user').addEventListener('click', () => { if (state.viewingProfile) goToConversationWith(state.viewingProfile); });

  $all('[data-close-modal]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.closeModal)));
  $('#modal-create-community').addEventListener('click', (e) => { if (e.target.id === 'modal-create-community') closeModal('modal-create-community'); });

  document.body.addEventListener('click', (e) => {
    const likeBtn = e.target.closest('[data-action="toggle-like"]');
    if (likeBtn) return handleToggleLike(likeBtn);
    const commentToggle = e.target.closest('[data-action="toggle-comments"]');
    if (commentToggle) return handleToggleComments(commentToggle);
    const deleteBtn = e.target.closest('[data-action="delete-post"]');
    if (deleteBtn) return handleDeletePost(deleteBtn);
    const authorBtn = e.target.closest('.post-author-name');
    if (authorBtn && authorBtn.dataset.username) return openPublicProfileByUsername(authorBtn.dataset.username);
    const joinBtn = e.target.closest('[data-action="join-community"]');
    if (joinBtn) return handleJoinCommunity(joinBtn);
    const leaveBtn = e.target.closest('[data-action="leave-community"]');
    if (leaveBtn) return handleLeaveCommunity(leaveBtn);
    const openCommBtn = e.target.closest('[data-action="open-community"]');
    if (openCommBtn) return openCommunity(openCommBtn.dataset.communityId);
    const convoItem = e.target.closest('.conversation-item');
    if (convoItem) return openConversation(convoItem.dataset.userId, convoItem.dataset.username, convoItem.dataset.displayname, convoItem.dataset.avatar);
  });

  document.body.addEventListener('submit', (e) => {
    const form = e.target.closest('.form-add-comment');
    if (form) { e.preventDefault(); handleAddComment(form); }
  });
}

/* ---------------------------- بدء التشغيل ---------------------------- */

async function init() {
  bindStaticEvents();

  if (!SUPABASE_URL || SUPABASE_URL.indexOf('ضع_') === 0 || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.indexOf('ضع_') === 0) {
    showAuthMessage('لم يتم ضبط الاتصال بالسيرفر بعد. افتح ملف js/config.js وضع رابط ومفتاح مشروعك في Supabase. راجع README.md للخطوات.', 'error');
  }

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    state.user = session.user;
    await loadMyProfile();
    if (state.profile) { showApp(); return; }
  }
  showAuth();

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      state.user = null; state.profile = null;
      showAuth();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
