import React, { useEffect, useRef, useState } from 'react';
import { Icon, IconLabel } from './Icon.jsx';
import { ConfirmDialog } from './Modal.jsx';
import Photo from './Photo.jsx';
import { day } from './media.js';
import { loadFriendsClient, loadFriendsData, friendPhotos, sharePhoto, unsharePhoto, result, friendlyMessage } from './friendsApi.js';

function FriendsPanel({ photos, onPhotos }) {
  const [client, setClient] = useState(null);
  const [configured, setConfigured] = useState(null);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [data, setData] = useState(null);
  // The result of the last action, shown at the bottom of the screen; `error` paints it red.
  const [notice, setNotice] = useState({ text: '', error: false });
  // Why the friends' information could not be read yet (shown instead of empty lists).
  const [loadProblem, setLoadProblem] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  // The hard-to-undo action waiting for a yes in the confirm dialog.
  const [confirming, setConfirming] = useState(null);
  const mounted = useRef(true);
  const version = useRef(0);
  const currentUser = useRef(null);
  const images = useRef(new Map());
  const shownPhotos = useRef('');
  const say = (text, error = false) => setNotice({ text, error });
  // On the long logged-in screen, successful results fade after a while; problems stay until the next action.
  useEffect(() => {
    if (!notice.text || notice.error || !user) return;
    const timer = setTimeout(() => setNotice({ text: '', error: false }), 8000);
    return () => clearTimeout(timer);
  }, [notice, user]);
  useEffect(() => {
    mounted.current = true;
    let subscription;
    let cancelled = false;
    (async () => {
      try {
        const value = await loadFriendsClient();
        if (cancelled) return;
        setConfigured(Boolean(value));
        if (!value) return;
        setClient(value);
        subscription = value.auth.onAuthStateChange((_event, session) => {
          const next = session?.user ?? null;
          if (currentUser.current !== next?.id) {
            currentUser.current = next?.id;
            version.current++;
            images.current.clear(); shownPhotos.current = '';
            setData(null); setLoadProblem(''); onPhotos([]);
          }
          setUser(next);
        }).data.subscription;
        const session = result(await value.auth.getSession()).session;
        if (!cancelled) { currentUser.current = session?.user?.id; setUser(session?.user ?? null); }
      } catch (error) { if (!cancelled) say(friendlyMessage(error), true); }
    })();
    return () => { cancelled = true; mounted.current = false; version.current++; subscription?.unsubscribe(); };
  }, [onPhotos, attempt]);

  // Returns how many friends' photos could not be loaded this time.
  async function refresh() {
    if (!client || !user) return 0;
    const token = ++version.current;
    const loaded = await loadFriendsData(client, user.id);
    const shared = await friendPhotos(client, loaded.shared, user.id, images.current);
    if (!mounted.current || token !== version.current) return 0;
    setData(loaded); setLoadProblem(''); setName(loaded.profile.display_name);
    // Redraw the map only when the set of friends' photos actually changed.
    const key = shared.photos.map(photo => photo.id).join();
    if (key !== shownPhotos.current) { shownPhotos.current = key; onPhotos(shared.photos); }
    return shared.failed;
  }
  const missingMessage = count => '友達の写真のうち' + count + '枚を読み込めませんでした。あとでもう一度読み込みます。';
  const hasData = useRef(false);
  hasData.current = Boolean(data);
  // Before anything has been read, a problem replaces the lists; afterwards the old lists stay and the problem is shown below.
  const loadFailed = text => { if (hasData.current) say(text, true); else setLoadProblem(text); };
  const offlineMessage = 'インターネットにつながっていません。つながると自動で読み込みます。';
  function load(isStopped = () => false) {
    if (navigator.onLine === false) { loadFailed(offlineMessage); return; }
    refresh().then(failed => { if (!isStopped() && failed) say(missingMessage(failed), true); })
      .catch(error => { if (!isStopped()) loadFailed(friendlyMessage(error)); });
  }
  useEffect(() => {
    if (!client || !user) return;
    let stopped = false;
    const update = () => {
      if (stopped || document.visibilityState === 'hidden') return;
      if (navigator.onLine === false && hasData.current) return;
      load(() => stopped);
    };
    update();
    const timer = setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    return () => {
      stopped = true; version.current++; clearInterval(timer);
      document.removeEventListener('visibilitychange', update); window.removeEventListener('online', update);
    };
  }, [client, user?.id]);

  async function action(task, success) {
    if (busy) return;
    setBusy(true); setNotice({ text: '', error: false });
    try { const message = await task(); if (mounted.current) say(message?.text ?? (message || success || '完了しました。'), Boolean(message?.error)); }
    catch (error) { if (mounted.current) say(friendlyMessage(error), true); }
    finally { if (mounted.current) setBusy(false); }
  }
  if (configured === null) return <div className="friend-state">
    <p role="status" className={notice.error ? 'friend-problem' : ''}>{notice.text || '共有機能を読み込んでいます…'}</p>
    {notice.error && <button className="has-icon" onClick={() => { say(''); setAttempt(value => value + 1); }}><IconLabel icon="refresh" label="もう一度読み込む" short="読み込む" /></button>}
  </div>;
  if (!configured) return <div className="friend-section"><h3>友達と写真・地図を共有</h3>
    <p>共有サーバーの接続設定がまだ完了していません。設定後、メールでログインして友達交換ができます。</p>
    <p>友達コードで申請 → 相手が承認 → 選んだ写真を友達の地図へ共有できます。</p>
  </div>;
  const profileName = id => data?.profiles.find(p => p.id === id)?.display_name || '友達';
  const incoming = data?.relationships.filter(f => f.recipient === user?.id && f.status === 'pending') || [];
  const accepted = data?.relationships.filter(f => f.status === 'accepted') || [];
  // The result line sits at the end and sticks to the bottom of the screen, so it shows next to whichever button was pressed.
  const resultLine = <p className={'friend-message' + (notice.error ? ' is-error' : '')} role="status" aria-live="polite">{notice.text}</p>;
  const outgoing = data?.relationships.filter(f => f.requester === user?.id && f.status === 'pending') || [];
  const myShares = data?.shared.filter(row => row.owner === user?.id) || [];
  const removeFriend = (f, done) => action(async () => { result(await client.rpc('remove_memory_friend', { request_id: f.id })); await refresh(); }, done);
  // Requests from others come first when there are any: they are what waits for an answer.
  const incomingSection = <section className={'friend-section' + (incoming.length ? ' friend-incoming' : '')}>
    <h3>届いた申請{incoming.length ? ' ' + incoming.length + '件' : ''}</h3>{!incoming.length && <p>申請はありません。</p>}
    {incoming.map(f => <div key={f.id} className="friend-row"><span>{profileName(f.requester)}</span>
      <button disabled={busy} onClick={() => action(async () => { result(await client.rpc('accept_memory_friend', { request_id: f.id })); await refresh(); }, '友達になりました。')}>承認</button>
      <button disabled={busy} onClick={() => removeFriend(f, '申請を削除しました。')}>拒否</button></div>)}
  </section>;
  const logout = () => action(async () => {
    result(await client.auth.signOut()); images.current.clear(); shownPhotos.current = ''; onPhotos([]); setData(null); setLoadProblem(''); setUser(null);
  }, 'ログアウトしました。');
  // Hard-to-undo buttons ask first, in the app's own dialog.
  async function confirmed() {
    await confirming.run();
    if (mounted.current) setConfirming(null);
  }
  return <div className={'friend-panel' + (user && data ? ' is-full' : '')}>
    {!user ? <form onSubmit={event => { event.preventDefault(); action(async () => {
      result(await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } }));
    }, 'ログイン用リンクを送りました。メールを確認してください。'); }}>
      <p>友達共有にはメールでログインしてください。端末内の写真はそのまま使えます。</p>
      <label>メールアドレス<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <button className="primary has-icon" disabled={busy}><IconLabel icon="mail" label="ログイン用メールを送る" short="送る" /></button>
    </form> : <>
      {!data ? <div className="friend-state">{loadProblem ? <>
        <p className="friend-problem" role="alert">{loadProblem}</p>
        <p>友達・届いた申請・共有した写真は、読み込めたら表示します。</p>
        <button className="has-icon" onClick={() => { setLoadProblem(''); load(); }}><IconLabel icon="refresh" label="もう一度読み込む" short="読み込む" /></button>
      </> : <p role="status">友達の情報を読み込んでいます…</p>}</div> : <>
      {incoming.length > 0 && incomingSection}
      <form onSubmit={event => { event.preventDefault(); action(async () => {
        result(await client.rpc('rename_memory_profile', { new_name: name.trim() })); await refresh();
      }, '名前を保存しました。'); }}>
        <label>友達に表示する名前<input required maxLength={30} value={name} onChange={event => setName(event.target.value)} /></label>
        <button className="has-icon" disabled={busy || !data}><IconLabel icon="check" label="名前を保存" short="保存" /></button>
      </form>
      <section className="friend-section"><h3>あなたの友達コード</h3><code className="friend-code">{data.profile.friend_code}</code>
        <button className="has-icon icon-only" title="コピー" disabled={busy} onClick={() => action(() => navigator.clipboard.writeText(data.profile.friend_code), 'コードをコピーしました。')}><IconLabel icon="copy" label="コピー" /></button>
        <p>このコードを友達に渡してください。申請を承認するまで写真は共有されません。知らない人から申請が届くときは、コードを作り直せます（今の友達はそのままです）。</p>
        <button className="has-icon" disabled={busy} onClick={() => setConfirming({ title: '友達コードを作り直しますか？',
          text: '今のコードは使えなくなり、元に戻せません。今の友達はそのままです。', confirmLabel: '作り直す', busyLabel: '作り直し中…',
          run: () => action(async () => { result(await client.rpc('regenerate_memory_friend_code')); await refresh(); }, '新しい友達コードを作りました。前のコードはもう使えません。') })}><IconLabel icon="refresh" label="コードを作り直す" short="作り直す" /></button></section>
      <form onSubmit={event => { event.preventDefault(); action(async () => {
        result(await client.rpc('request_memory_friend', { code: code.trim() })); setCode(''); await refresh();
      }, '友達申請を送りました。'); }}>
        <label>友達のコード<input required value={code} onChange={event => setCode(event.target.value)} placeholder="友達から受け取ったコード" /></label>
        <button className="has-icon" disabled={busy}><IconLabel icon="send" label="友達申請を送る" short="申請" /></button>
      </form>
      {!incoming.length && incomingSection}
      <section className="friend-section"><h3>友達 {accepted.length}人</h3>{accepted.map(f => { const friend = profileName(f.requester === user.id ? f.recipient : f.requester);
        return <div key={f.id} className="friend-row"><span>{friend}</span>
          <button disabled={busy} onClick={() => setConfirming({ title: friend + 'さんとの友達を解除しますか？',
            text: 'おたがいの写真の共有も止まり、元に戻せません。また友達になるには、申請からやり直します。', confirmLabel: '解除する', busyLabel: '解除中…',
            run: () => removeFriend(f, '友達を解除しました。') })}>解除</button>
        </div>; })}
      {outgoing.map(f => <div className="friend-row" key={f.id}><span>{profileName(f.recipient)}（承認待ち）</span><button disabled={busy} onClick={() => removeFriend(f, '申請を取り消しました。')}>取消</button></div>)}
      </section>
      <section className="friend-section"><h3>写真を共有</h3><p>共有した写真と撮影場所は、承認済みの友達全員が見られます。共有はいつでも停止できます。</p>
        {!photos.length && <p>撮影した写真がありません。</p>}
        {photos.map(photo => { const row = myShares.find(r => r.local_id === photo.id);
          return <div key={photo.id} className="friend-row friend-photo-row"><Thumb blob={photo.blob} />
            <span>{photo.caption || '名前のない思い出'}<small>{day(photo.createdAt)}</small></span><button className="has-icon" disabled={busy} onClick={() => action(async () => {
            if (row) { const message = await unsharePhoto(client, row); await refresh(); return message; }
            await sharePhoto(client, user, photo); await refresh();
          }, '写真を共有しました。')}>{row ? <IconLabel icon="stop" label="共有を停止" short="停止" /> : <IconLabel icon="share" label="友達に共有" short="共有" />}</button></div>;
        })}
        {myShares.filter(row => !photos.some(p => p.id === row.local_id)).map(row => <div className="friend-row friend-photo-row" key={row.id}><Thumb />
          <span>{row.caption || '端末にない共有写真'}{row.captured_at && <small>{day(row.captured_at)}</small>}</span><button className="has-icon" disabled={busy} onClick={() => action(async () => { const message = await unsharePhoto(client, row); await refresh(); return message; })}><IconLabel icon="stop" label="共有を停止" short="停止" /></button></div>)}
      </section>
      <button className="has-icon" disabled={busy} onClick={() => action(async () => { const failed = await refresh(); if (failed) return { text: missingMessage(failed), error: true }; }, '友達の写真を更新しました。')}><IconLabel icon="refresh" label="写真・申請を更新" short="更新" /></button>
    </>}
      {/* Logging out is rarely needed and hard to take back, so it sits at the end, apart from everyday buttons. */}
      <section className="friend-section friend-account"><span>ログイン中</span><button disabled={busy} onClick={logout}>ログアウト</button></section>
      {confirming && <ConfirmDialog title={confirming.title} text={confirming.text} confirmLabel={confirming.confirmLabel} busyLabel={confirming.busyLabel}
        busy={busy} onCancel={() => setConfirming(null)} onConfirm={confirmed} />}
    </>}
    {resultLine}
  </div>;
}

// A small picture of the photo, so rows without a name can still be told apart. Grey until the picture is ready.
function Thumb({ blob }) {
  return <span className="friend-thumb" aria-hidden="true">{blob ? <Photo blob={blob} thumb={144} alt="" /> : <Icon name="album" size={20} />}</span>;
}

export default function FriendsDialog({ open, onClose, photos, onPhotos }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (open && !dialog.current.open) dialog.current.showModal();
    else if (!open && dialog.current.open) dialog.current.close();
  }, [open]);
  return <dialog ref={dialog} className="friend-dialog" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-head"><h2>友達交換</h2><button aria-label="閉じる" onClick={onClose}>×</button></div>
    <FriendsPanel photos={photos} onPhotos={onPhotos} />
  </dialog>;
}
