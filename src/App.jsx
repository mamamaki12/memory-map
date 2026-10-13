import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InstallNotice from './InstallNotice.jsx';
import { readBackup, restoreBackup } from './backup.js';
import { trackLocation } from './locationTracker.js';
import FriendsDialog from './FriendsPanel.jsx';
import ConquestMap from './ConquestMap.jsx';
import PhotoMap from './PhotoMap.jsx';
import useDrawerGesture from './useDrawerGesture.js';
import { openDB, transaction } from './storage.js';
import { position, compress, date, download } from './media.js';

function Photo({ blob, ...props }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const value = URL.createObjectURL(blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return url ? <img {...props} src={url} /> : null;
}

function Modal({ title, onClose, busy, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-head"><h2>{title}</h2><button disabled={busy} onClick={onClose} aria-label="閉じる">×</button></div>
    {children}
  </dialog>;
}

export default function App() {
  const db = useRef(null);
  const file = useRef(null);
  const importFile = useRef(null);
  const [importing, setImporting] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const operation = useRef(false);
  const tracker = useRef(null);
  const latestLocation = useRef(null);
  const [ready, setReady] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [mapMode, setMapMode] = useState('photos');
  const [sharedPhotos, setSharedPhotos] = useState([]);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const mapPhotos = useMemo(() => [...photos, ...sharedPhotos].sort((a, b) => b.createdAt - a.createdAt), [photos, sharedPhotos]);
  const [pending, setPending] = useState(null);
  const [active, setActive] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [fitRequest, setFitRequest] = useState(0);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const drawer = useDrawerGesture(memoriesOpen, setMemoriesOpen);
  const notify = useCallback(message => setStatus(message), []);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 6500);
    return () => clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    let disposed = false;
    let connection;
    (async () => {
      try {
        connection = await openDB();
        if (disposed) { connection.close(); return; }
        const stored = await transaction(connection, 'readonly', store => store.getAll());
        if (disposed) return;
        db.current = connection;
        setPhotos(stored.sort((a, b) => b.createdAt - a.createdAt));
        setReady(true);
        setFitRequest(1);
      } catch {
        if (!disposed) notify('保存領域を開けません。ブラウザの保存設定を確認して再読み込みしてください。');
      }
    })();
    return () => { disposed = true; connection?.close(); };
  }, [notify]);

  useEffect(() => {
    if (!window.isSecureContext || !navigator.geolocation) {
      notify('現在地の追跡にはHTTPSと位置情報に対応したブラウザが必要です。');
      return;
    }
    const watcher = trackLocation({
      geolocation: navigator.geolocation,
      page: document,
      onPosition(place) { latestLocation.current = place; setCurrentLocation(place); },
      onError(error) {
        if (error.code === 1) {
          latestLocation.current = null;
          setCurrentLocation(null);
          notify('位置情報が許可されていません。許可後に「現在地」を押してください。');
        } else notify('現在地を取得できません。位置情報の更新を待っています。');
      },
    });
    tracker.current = watcher;
    return () => { watcher.dispose(); tracker.current = null; };
  }, [notify]);

  async function capture(event) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected || operation.current) return;
    operation.current = true;
    setBusy(true);
    notify('写真と現在地を準備しています…');
    const cached = latestLocation.current;
    const location = cached && Date.now() - cached.timestamp < 15000
      ? Promise.resolve(cached) : position().catch(() => null);
    try {
      const blob = await compress(selected);
      const place = await location;
      setPending({ id: crypto.randomUUID(), blob, createdAt: Date.now(), caption: '', ...place });
      if (place) { setView(place); setCurrentLocation(place); }
      notify(place ? '場所を確認して保存してください。' : '現在地を取得できませんでした。地図で場所を選んでください。');
    } catch {
      notify('写真を読み込めません。40MB以下のJPEGまたはPNGをお試しください。');
    } finally { operation.current = false; setBusy(false); }
  }

  async function save(event) {
    event.preventDefault();
    if (operation.current || !pending || !Number.isFinite(pending.lat) || !Number.isFinite(pending.lng)) return;
    operation.current = true;
    setBusy(true);
    const photo = { ...pending, caption: pending.caption.trim() };
    try {
      await transaction(db.current, 'readwrite', store => store.put(photo));
      setPhotos(previous => [photo, ...previous]);
      setPending(null);
      setFitRequest(0);
      setView({ lat: photo.lat, lng: photo.lng });
      notify('思い出を地図に保存しました。');
    } catch {
      notify('保存できません。端末の空き容量やブラウザの保存設定を確認してください。');
    } finally { operation.current = false; setBusy(false); }
  }

  async function remove() {
    if (!active || operation.current || !confirm('この写真をこのブラウザから削除しますか？')) return;
    operation.current = true;
    setBusy(true);
    try {
      await transaction(db.current, 'readwrite', store => store.delete(active.id));
      setPhotos(previous => previous.filter(photo => photo.id !== active.id));
      setActive(null);
      notify('写真を削除しました。');
    } catch { notify('削除に失敗しました。もう一度お試しください。'); }
    finally { operation.current = false; setBusy(false); }
  }

  async function locate() {
    setLocating(true);
    try {
      const cached = latestLocation.current;
      const place = cached && Date.now() - cached.timestamp < 15000 ? cached : await position();
      tracker.current?.retry();
      setCurrentLocation(place);
      setView(place);
      setFitRequest(0);
    }
    catch (error) { notify(error.message); }
    finally { setLocating(false); }
  }

  async function importBackup(event) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected || operation.current) return;
    operation.current = true;
    setImporting(true);
    setSettingsMessage('バックアップを確認しています…');
    try {
      const incoming = await readBackup(selected);
      if (!incoming.length) { setSettingsMessage('このバックアップには写真がありません。'); return; }
      setSettingsMessage('写真を復元しています…');
      const result = await restoreBackup(db.current, incoming);
      setPhotos(result.photos.sort((a, b) => b.createdAt - a.createdAt));
      setFitRequest(value => value + 1);
      setSettingsMessage(result.added + '枚を復元しました。' + (result.skipped ? result.skipped + '枚は保存済みのためスキップしました。' : ''));
    } catch (error) {
      setSettingsMessage(error?.name === 'QuotaExceededError' ? '空き容量が不足しています。復元は行っていません。' : error?.message || '復元できませんでした。既存の写真は変更していません。');
    } finally { operation.current = false; setImporting(false); }
  }

  async function backup() {
    if (!photos.length) return setSettingsMessage('保存した写真がありません。');
    setExporting(true);
    try {
      const output = await Promise.all(photos.map(photo => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { const { blob, ...meta } = photo; resolve({ ...meta, image: reader.result }); };
        reader.onerror = reject;
        reader.readAsDataURL(photo.blob);
      })));
      download(new Blob([JSON.stringify({ version: 1, photos: output })], { type: 'application/json' }), 'memory-map-backup.json');
      setSettingsMessage('写真と場所をJSON形式で書き出しました。');
    } catch { setSettingsMessage('書き出しに失敗しました。写真を個別にダウンロードしてください。'); }
    finally { setExporting(false); }
  }

  const openPhoto = useCallback(photo => {
    setFitRequest(0);
    setView({ lat: photo.lat, lng: photo.lng });
    setActive(photo);
  }, []);
  const pickPlace = useCallback(place => {
    setPending(previous => previous ? { ...previous, lat: place.lat, lng: place.lng, accuracy: undefined } : null);
    setSelecting(false);
  }, []);
  const cancel = () => { setPending(null); setSelecting(false); };

  return <>
    <header><a className="brand" href={import.meta.env.BASE_URL}><img className="logo" src={import.meta.env.BASE_URL + 'icon-landscape.svg'} width="45" height="45" alt="" /><span>Memory Map<small>思い出を、地図に。</small></span></a>
      <div className="header-actions">
      <button className="friends-button" onClick={() => setFriendsOpen(true)}>友達</button>
      <button className="map-toggle-button"
        aria-label={mapMode === 'conquest' ? '現在は全国攻略。写真の地図に切り替える' : '現在は写真の地図。全国攻略に切り替える'}
        title={mapMode === 'conquest' ? '写真の地図に切り替え' : '全国攻略に切り替え'}
        disabled={busy || selecting}
        onClick={() => { setMapMode(mode => mode === 'photos' ? 'conquest' : 'photos'); setMemoriesOpen(false); }}>
        <span className="map-mode-card" data-active={mapMode === 'photos'} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v13H3V7a1 1 0 0 1 1-1Z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </span>
        <span className="map-mode-card" data-active={mapMode === 'conquest'} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z" />
            <path d="M9 3v16M15 5v16" />
          </svg>
        </span>
      </button>
      <button className="settings-button" aria-label="設定を開く" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9.5 3-.5 2-2 .9-1.9-.6-2.5 4.3 1.5 1.4v2l-1.5 1.4 2.5 4.3 1.9-.6 2 .9.5 2h5l.5-2 2-.9 1.9.6 2.5-4.3-1.5-1.4v-2l1.5-1.4-2.5-4.3-1.9.6-2-.9-.5-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button></div></header>
    <FriendsDialog open={friendsOpen} onClose={() => setFriendsOpen(false)} photos={photos} onPhotos={setSharedPhotos} />
    <InstallNotice />
    {mapMode==='conquest' && <ConquestMap photos={photos} />}
    <main className={mapMode==='conquest'?'photo-map-hidden':''}>
      {memoriesOpen && <button className="memories-backdrop" aria-label="思い出の一覧を閉じる" onClick={() => setMemoriesOpen(false)} />}
      <aside className={'memories-panel' + (memoriesOpen ? ' is-open' : '') + (drawer.dragOffset !== null ? ' is-dragging' : '')}
        style={{ '--drawer-drag': (drawer.dragOffset ?? 0) + 'px' }} onKeyDown={event => {
        if (event.key === 'Escape') { setMemoriesOpen(false); event.currentTarget.querySelector('.memories-toggle')?.focus(); }
      }}>
        <button className="memories-toggle" aria-expanded={memoriesOpen} aria-controls="memories-list" {...drawer.handleProps}>
          <span className="sheet-handle" aria-hidden="true" />
          <span className="sheet-title">思い出</span><span className="sheet-count">{mapPhotos.length} 枚</span><span className="sheet-chevron" aria-hidden="true">{memoriesOpen ? '⌄' : '⌃'}</span>
        </button>
        <div className="intro"><span className="eyebrow">YOUR PERSONAL ATLAS</span><h1>ここにいた、<br />を残そう。</h1><p>いつもの道も、初めての街も。<br />写真から広がる、あなただけの地図。</p></div>
        <div className="section-title"><h2>思い出</h2><span>{photos.length} 枚</span></div>
        <div className="list" id="memories-list" {...drawer.listProps}>{mapPhotos.length ? mapPhotos.map(photo =>
          <button key={photo.id} className="memory" onClick={() => openPhoto(photo)} disabled={selecting}>
            <Photo blob={photo.blob} alt={photo.caption || '思い出の写真'} loading="lazy" />
            <span>{photo.caption || '名前のない思い出'}<small>{photo.shared ? '友達の写真 · ' : ''}{date(photo.createdAt)}</small></span>
          </button>) : <p className="empty">{ready ? 'まだ写真がありません。最初の一枚を撮ってみましょう。' : '保存した写真を読み込んでいます…'}</p>}</div>
        <p className="privacy">写真はこの端末のブラウザに保存されます。大切な写真はバックアップしてください。</p>
      </aside>
      <section className="map-wrap" aria-label="写真の地図">
        <PhotoMap photos={mapPhotos} onOpen={openPhoto} onPick={pickPlace} selecting={selecting} view={view} currentLocation={currentLocation} fitRequest={fitRequest} onError={notify} />
        <div className="map-tools"><button disabled={locating} onClick={locate}>{locating ? '取得中…' : '⌖ 現在地'}</button><button onClick={() => mapPhotos.length ? setFitRequest(value => value + 1) : notify('写真を保存すると地図上に表示されます。')}>すべて表示</button></div>
        {selecting && <div id="place-hint">地図をタップして場所を選んでください <button onClick={() => setSelecting(false)}>戻る</button></div>}
        <div className="capture-bar"><button className="primary" disabled={!ready || busy} onClick={() => pending ? setSelecting(false) : file.current.click()}>{busy ? '処理中…' : pending ? '保存画面に戻る' : '＋ 写真を撮る'}</button><span>今日の景色を、思い出に。</span></div>
      </section>
    </main>
    <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={capture} />
    <p id="status" role="status" aria-live="polite">{status}</p>
    {settingsOpen && <Modal title="設定" busy={importing || exporting} onClose={() => setSettingsOpen(false)}>
      <button className="settings-item" disabled={!ready || exporting || importing} onClick={backup}>
        <span>{exporting ? '書き出し中…' : 'バックアップ'}</span>
        <small>写真と撮影場所をファイルに保存</small>
      </button>
      <input ref={importFile} type="file" accept=".json,application/json" hidden onChange={importBackup} />
      <button className="settings-item" disabled={!ready || exporting || importing} onClick={() => importFile.current.click()}>
        <span>{importing ? '復元中…' : 'バックアップをインポート'}</span>
        <small>JSONから写真と場所を復元（100MBまで・既存写真は保持）</small>
      </button>
      <p className="settings-result" role="status" aria-live="polite">{settingsMessage}</p>
      <p className="settings-note">写真はこのブラウザに保存されています。大切な思い出は定期的にバックアップしてください。</p>
    </Modal>}
    {pending && !selecting && <Modal title="思い出を保存" onClose={cancel} busy={busy}>
      <form onSubmit={save}><Photo blob={pending.blob} alt="撮影した写真" />
        <label>ひとこと<input value={pending.caption} disabled={busy} maxLength={100} placeholder="例：帰り道で見つけた夕焼け" onChange={event => setPending({ ...pending, caption: event.target.value })} /></label>
        <p id="location-label">{Number.isFinite(pending.lat) ? '保存場所：' + pending.lat.toFixed(5) + ', ' + pending.lng.toFixed(5) + (pending.accuracy ? '（精度 約' + Math.round(pending.accuracy) + 'm）' : '') : '保存する場所を地図で選んでください。'}</p>
        <button type="button" className="quiet" disabled={busy} onClick={() => setSelecting(true)}>地図で場所を選び直す</button>
        <button id="save" className="primary" disabled={busy || !Number.isFinite(pending.lat)} type="submit">{busy ? '保存中…' : 'この場所に保存'}</button>
      </form>
    </Modal>}
    {active && <Modal title={active.caption || '名前のない思い出'} onClose={() => setActive(null)} busy={busy}>
      <Photo blob={active.blob} alt={active.caption || '思い出の写真'} /><p id="detail-date">{date(active.createdAt)}</p>
      <button className="quiet" onClick={() => download(active.blob, 'memory-' + active.id + '.jpg')}>写真をダウンロード</button>
      {active.shared ? <p className="settings-note">友達が共有した写真です。</p> : <button className="danger" disabled={busy} onClick={remove}>この写真を削除</button>}
    </Modal>}
  </>;
}
