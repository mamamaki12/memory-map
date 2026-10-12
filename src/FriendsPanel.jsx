import React, { useEffect, useRef, useState } from 'react';
import { loadFriendsClient, loadFriendsData, friendPhotos, sharePhoto, unsharePhoto, result } from './friendsApi.js';

function FriendsPanel({ photos, onPhotos }) {
  const [client, setClient] = useState(null);
  const [configured, setConfigured] = useState(null);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const version = useRef(0);
  const currentUser = useRef(null);
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
            setData(null); onPhotos([]);
          }
          setUser(next);
        }).data.subscription;
        const session = result(await value.auth.getSession()).session;
        if (!cancelled) { currentUser.current = session?.user?.id; setUser(session?.user ?? null); }
      } catch (error) { if (!cancelled) setMessage(error.message); }
    })();
    return () => { cancelled = true; mounted.current = false; version.current++; subscription?.unsubscribe(); };
  }, [onPhotos]);

  async function refresh() {
    if (!client || !user) return;
    const token = ++version.current;
    const loaded = await loadFriendsData(client);
    const shared = await friendPhotos(client, loaded.shared, user.id);
    if (!mounted.current || token !== version.current) return;
    setData(loaded); setName(loaded.profile.display_name); onPhotos(shared);
  }
  useEffect(() => {
    if (!client || !user) return;
    let stopped = false;
    const update = () => { if (!stopped && document.visibilityState !== 'hidden') refresh().catch(error => { if (!stopped) setMessage(error.message); }); };
    update();
    const timer = setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => { stopped = true; version.current++; clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [client, user?.id]);

  async function action(task, success) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { const message = await task(); if (mounted.current) setMessage(message || success || '完了しました。'); }
    catch (error) { if (mounted.current) setMessage(error.message || '処理に失敗しました。'); }
    finally { if (mounted.current) setBusy(false); }
  }
  if (configured === null) return <p role="status">{message || '共有機能を読み込んでいます…'}</p>;
  if (!configured) return <div className="friend-section"><h3>友達と写真・地図を共有</h3>
    <p>共有サーバーの接続設定がまだ完了していません。設定後、メールでログインして友達交換ができます。</p>
    <p>友達コードで申請 → 相手が承認 → 選んだ写真を友達の地図へ共有できます。</p>
  </div>;
  const profileName = id => data?.profiles.find(p => p.id === id)?.display_name || '友達';
  const incoming = data?.relationships.filter(f => f.recipient === user?.id && f.status === 'pending') || [];
  const accepted = data?.relationships.filter(f => f.status === 'accepted') || [];
  return <div className="friend-panel">
    <p className="friend-message" role="status" aria-live="polite">{message}</p>
    {!user ? <form onSubmit={event => { event.preventDefault(); action(async () => {
      result(await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } }));
    }, 'ログイン用リンクを送りました。メールを確認してください。'); }}>
      <p>友達共有にはメールでログインしてください。端末内の写真はそのまま使えます。</p>
      <label>メールアドレス<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <button className="primary" disabled={busy}>ログイン用メールを送る</button>
    </form> : <>
      <div className="friend-toolbar"><span>ログイン中</span><button disabled={busy} onClick={() => action(async () => {
        result(await client.auth.signOut()); onPhotos([]); setData(null); setUser(null);
      }, 'ログアウトしました。')}>ログアウト</button></div>
      <form onSubmit={event => { event.preventDefault(); action(async () => {
        result(await client.rpc('rename_memory_profile', { new_name: name.trim() })); await refresh();
      }, '名前を保存しました。'); }}>
        <label>友達に表示する名前<input required maxLength={30} value={name} onChange={event => setName(event.target.value)} /></label>
        <button disabled={busy || !data}>名前を保存</button>
      </form>
      {data && <section className="friend-section"><h3>あなたの友達コード</h3><code className="friend-code">{data.profile.friend_code}</code>
        <button disabled={busy} onClick={() => action(() => navigator.clipboard.writeText(data.profile.friend_code), 'コードをコピーしました。')}>コピー</button>
        <p>このコードを友達に渡してください。申請を承認するまで写真は共有されません。</p></section>}
      <form onSubmit={event => { event.preventDefault(); action(async () => {
        result(await client.rpc('request_memory_friend', { code: code.trim() })); setCode(''); await refresh();
      }, '友達申請を送りました。'); }}>
        <label>友達のコード<input required value={code} onChange={event => setCode(event.target.value)} placeholder="友達から受け取ったコード" /></label>
        <button disabled={busy}>友達申請を送る</button>
      </form>
      <section className="friend-section"><h3>届いた申請</h3>{!incoming.length && <p>申請はありません。</p>}
        {incoming.map(f => <div key={f.id} className="friend-row"><span>{profileName(f.requester)}</span>
          <button disabled={busy} onClick={() => action(async () => { result(await client.rpc('accept_memory_friend', { request_id: f.id })); await refresh(); }, '友達になりました。')}>承認</button>
          <button disabled={busy} onClick={() => action(async () => { result(await client.rpc('remove_memory_friend', { request_id: f.id })); await refresh(); }, '申請を削除しました。')}>拒否</button></div>)}
      </section>
      <section className="friend-section"><h3>友達 {accepted.length}人</h3>{accepted.map(f => <div key={f.id} className="friend-row">
        <span>{profileName(f.requester === user.id ? f.recipient : f.requester)}</span>
        <button disabled={busy} onClick={() => { if (confirm('友達を解除しますか？互いの写真共有も停止します。')) action(async () => { result(await client.rpc('remove_memory_friend', { request_id: f.id })); await refresh(); }, '友達を解除しました。'); }}>解除</button>
      </div>)}
      {data?.relationships.filter(f => f.requester === user.id && f.status === 'pending').map(f => <div className="friend-row" key={f.id}><span>{profileName(f.recipient)}（承認待ち）</span><button disabled={busy} onClick={() => action(async () => { result(await client.rpc('remove_memory_friend', { request_id: f.id })); await refresh(); }, '申請を取り消しました。')}>取消</button></div>)}
      </section>
      <section className="friend-section"><h3>写真を共有</h3><p>共有した写真と撮影場所は、承認済みの友達全員が見られます。共有はいつでも停止できます。</p>
        {!photos.length && <p>撮影した写真がありません。</p>}
        {photos.map(photo => { const row = data?.shared.find(r => r.owner === user.id && r.local_id === photo.id);
          return <div key={photo.id} className="friend-row"><span>{photo.caption || '名前のない思い出'}</span><button disabled={busy || !data} onClick={() => action(async () => {
            if (row) { const message = await unsharePhoto(client, row); await refresh(); return message; }
            await sharePhoto(client, user, photo); await refresh();
          }, '写真を共有しました。')}>{row ? '共有を停止' : '友達に共有'}</button></div>;
        })}
        {data?.shared.filter(row => row.owner === user.id && !photos.some(p => p.id === row.local_id)).map(row => <div className="friend-row" key={row.id}><span>{row.caption || '端末にない共有写真'}</span><button disabled={busy} onClick={() => action(async () => { const message = await unsharePhoto(client, row); await refresh(); return message; })}>共有を停止</button></div>)}
      </section>
      <button disabled={busy} onClick={() => action(refresh, '友達の写真を更新しました。')}>写真・申請を更新</button>
    </>}
  </div>;
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
