import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InstallNotice from './InstallNotice.jsx';
import { readBackup, restoreBackup } from './backup.js';
import { loadBackupState, saveBackupState, unbackedCount, backupReminder, backupFileName } from './backupReminder.js';
import { trackLocation } from './locationTracker.js';
import FriendsDialog from './FriendsPanel.jsx';
import ConquestMap from './ConquestMap.jsx';
import PhotoMap from './PhotoMap.jsx';
import PlacePreview from './PlacePreview.jsx';
import useDrawerGesture from './useDrawerGesture.js';
import { monthGroups, showMonthHeadings } from './monthGroups.js';
import { openDB, transaction } from './storage.js';
import { position, compress, date, download } from './media.js';
import { readPhotoLocation } from './exifLocation.js';
import { Icon, IconLabel } from './Icon.jsx';
import { Modal, ConfirmDialog } from './Modal.jsx';
import Photo from './Photo.jsx';

// A short line saying where the saved place came from.
function placeLabel(pending) {
  if (pending.placeSource === 'photo') return '写真の撮影場所';
  if (pending.placeSource === 'map') return '地図で選んだ場所';
  return '現在地' + (pending.accuracy ? '（精度 約' + Math.round(pending.accuracy) + 'm）' : '');
}

// Ask once per visit that the browser keep the photos even when it is short of space.
let persistRequested = false;
function keepPhotos() {
  if (persistRequested || !navigator.storage?.persist) return;
  persistRequested = true;
  navigator.storage.persisted().then(done => done || navigator.storage.persist()).catch(() => {});
}

// The photo count reads the same everywhere: just the number, or yours and your friends' when friends share photos.
function photoCount(own, friends) {
  return friends ? '自分 ' + own + '・友達 ' + friends : own + ' 枚';
}

// The two maps, each with a word, so it is clear which one is showing.
const mapModes = [
  { mode: 'photos', icon: 'album', label: '写真の地図', short: '写真' },
  { mode: 'conquest', icon: 'map', label: '全国攻略', short: '攻略' },
];

// Phones choose between the camera and the album; a mouse-only computer has no camera mode for file inputs.
const touchDevice = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

export default function App() {
  const db = useRef(null);
  const cameraFile = useRef(null);
  const albumFile = useRef(null);
  const [sourceOpen, setSourceOpen] = useState(false);
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
  const months = useMemo(() => monthGroups(mapPhotos), [mapPhotos]);
  const [pending, setPending] = useState(null);
  const [active, setActive] = useState(null);
  const [placePhotos, setPlacePhotos] = useState(null);
  const placeMonths = useMemo(() => placePhotos && monthGroups(placePhotos), [placePhotos]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
  const [backupState, setBackupState] = useState(loadBackupState);
  const drawer = useDrawerGesture(memoriesOpen, setMemoriesOpen);
  const notify = useCallback(message => setStatus(message), []);

  useEffect(() => {
    if (!status) return;
    // Longer messages stay a little longer so they can be read to the end.
    const timer = setTimeout(() => setStatus(''), Math.min(12000, Math.max(6500, status.length * 130)));
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
          notify('位置情報が許可されていません。ブラウザやスマホの設定で許可したあと、右下の現在地ボタンを押してください。');
        } else notify('現在地を取得できません。位置情報の更新を待っています。');
      },
    });
    tracker.current = watcher;
    return () => { watcher.dispose(); tracker.current = null; };
  }, [notify]);
  useEffect(() => {
    const offline = () => notify('インターネットに接続されていません。写真は保存できますが、地図が表示されないことがあります。');
    window.addEventListener('offline', offline);
    return () => window.removeEventListener('offline', offline);
  }, [notify]);

  async function capture(event, source) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected || operation.current) return;
    operation.current = true;
    setBusy(true);
    notify('写真と現在地を準備しています…');
    // Album photos carry where they were taken; read it before compress() drops the EXIF.
    const fromAlbum = source === 'album';
    const photoPlace = fromAlbum ? await readPhotoLocation(selected) : null;
    const cached = latestLocation.current;
    let locationProblem = '';
    const location = photoPlace ? Promise.resolve(photoPlace) : cached && Date.now() - cached.timestamp < 15000
      ? Promise.resolve(cached) : position().catch(error => {
        locationProblem = error.code === 1 ? '位置情報が許可されていないため、現在地を使えません。' : '現在地を取得できませんでした。';
        return null;
      });
    try {
      const blob = await compress(selected);
      const place = await location;
      // placeSource says where the place came from; noPhotoPlace marks album photos without a recorded place.
      setPending({ id: crypto.randomUUID(), blob, createdAt: Date.now(), caption: '', ...place, ...(place ? {} : { locationProblem }),
        placeSource: photoPlace ? 'photo' : 'current', noPhotoPlace: fromAlbum && !photoPlace });
      if (place) { setView(place); if (!photoPlace) setCurrentLocation(place); }
      notify(place ? '場所を確認して保存してください。' : locationProblem + '地図で場所を選んでください。');
    } catch {
      notify('写真を読み込めません。40MB以下のJPEGまたはPNGをお試しください。');
    } finally { operation.current = false; setBusy(false); }
  }

  async function save(event) {
    event.preventDefault();
    if (operation.current || !pending || !Number.isFinite(pending.lat) || !Number.isFinite(pending.lng)) return;
    operation.current = true;
    setBusy(true);
    const { locationProblem, placeSource, noPhotoPlace, ...photo } = { ...pending, caption: pending.caption.trim() };
    try {
      await transaction(db.current, 'readwrite', store => store.put(photo));
      setPhotos(previous => [photo, ...previous]);
      setPending(null);
      setFitRequest(0);
      setView({ lat: photo.lat, lng: photo.lng });
      const nextBackup = { ...backupState, added: backupState.added + 1 };
      setBackupState(nextBackup);
      saveBackupState(nextBackup);
      notify('思い出を地図に保存しました。' + backupReminder(nextBackup, photos.length + 1));
      keepPhotos();
    } catch {
      notify('保存できません。端末の空き容量やブラウザの保存設定を確認してください。');
    } finally { operation.current = false; setBusy(false); }
  }

  async function remove() {
    if (!active || operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await transaction(db.current, 'readwrite', store => store.delete(active.id));
      setPhotos(previous => previous.filter(photo => photo.id !== active.id));
      setActive(null);
      notify('写真を削除しました。');
    } catch { notify('削除に失敗しました。もう一度お試しください。'); }
    finally { operation.current = false; setBusy(false); setConfirmingDelete(false); }
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
    setSettingsMessage('ファイルを確かめています…');
    try {
      const incoming = await readBackup(selected);
      if (!incoming.length) { setSettingsMessage('このファイルには写真が入っていません。'); return; }
      setSettingsMessage('写真を戻しています…');
      const result = await restoreBackup(db.current, incoming);
      setPhotos(result.photos.sort((a, b) => b.createdAt - a.createdAt));
      setFitRequest(value => value + 1);
      setSettingsMessage(!result.added ? 'このファイルの写真は、すべてもう入っていました（' + result.skipped + '枚）。'
        : result.added + '枚の写真を戻しました。' + (result.skipped ? result.skipped + '枚はもう入っていたので、そのままにしました。' : ''));
    } catch (error) {
      setSettingsMessage(error?.name === 'QuotaExceededError' ? '端末の空きが足りないため、写真を戻せませんでした。今ある写真はそのままです。' : error?.message || '写真を戻せませんでした。今ある写真はそのままです。');
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
      download(new Blob([JSON.stringify({ version: 1, photos: output })], { type: 'application/json' }), backupFileName());
      const done = { at: Date.now(), added: 0 };
      setBackupState(done);
      saveBackupState(done);
      setSettingsMessage('バックアップを保存しました。ファイルは端末の「ダウンロード」などに入っています。');
    } catch { setSettingsMessage('バックアップを保存できませんでした。大切な写真は1枚ずつダウンロードしてください。'); }
    finally { setExporting(false); }
  }

  const openPhoto = useCallback(photo => {
    setFitRequest(0);
    setView({ lat: photo.lat, lng: photo.lng });
    setActive(photo);
  }, []);
  const mapCenter = useRef(null);
  const reportCenter = useCallback(center => { mapCenter.current = center; }, []);
  // Choosing a place again: show the current choice in the middle of the big map.
  const startPicking = () => {
    if (Number.isFinite(pending?.lat)) { setFitRequest(0); setView({ lat: pending.lat, lng: pending.lng }); }
    setSelecting(true);
  };
  const pickPlace = () => {
    const place = mapCenter.current;
    if (!place) return;
    setPending(previous => previous ? { ...previous, lat: place.lat, lng: place.lng, accuracy: undefined, locationProblem: undefined, placeSource: 'map', noPhotoPlace: false } : null);
    setSelecting(false);
  };
  useEffect(() => {
    if (!selecting) return;
    // Return after this key press has finished, so the same Escape does not also close the save screen.
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); setTimeout(() => setSelecting(false)); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [selecting]);
  const cancel = () => { setPending(null); setSelecting(false); };
  // From the empty conquest map: show the photo map and put the keyboard on "写真を追加".
  const showPhotoMap = () => {
    setMapMode('photos');
    setMemoriesOpen(false);
    requestAnimationFrame(() => document.querySelector('.capture-bar .primary')?.focus());
  };
  const addPhoto = () => touchDevice() ? setSourceOpen(true) : albumFile.current.click();
  // Open the picker during the tap itself so phones allow it, then close the sheet.
  const pickSource = input => { input.current.click(); setSourceOpen(false); };

  return <>
    <header><a className="brand" href={import.meta.env.BASE_URL}><img className="logo" src={import.meta.env.BASE_URL + 'icon-landscape.svg'} width="45" height="45" alt="" /><span>Memory Map<small>思い出を、地図に。</small></span></a>
      <div className="header-actions">
      <button className="friends-button has-icon icon-only" title="友達" onClick={() => setFriendsOpen(true)}><IconLabel icon="friends" label="友達" /></button>
      <div className="map-switch" role="group" aria-label="地図の切り替え">{mapModes.map(item =>
        <button key={item.mode} className="has-icon" aria-pressed={mapMode === item.mode} disabled={busy || selecting}
          onClick={() => { if (mapMode !== item.mode) { setMapMode(item.mode); setMemoriesOpen(false); } }}>
          <IconLabel icon={item.icon} label={item.label} short={item.short} /></button>)}</div>
      <button className="settings-button" aria-label="設定を開く" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9.5 3-.5 2-2 .9-1.9-.6-2.5 4.3 1.5 1.4v2l-1.5 1.4 2.5 4.3 1.9-.6 2 .9.5 2h5l.5-2 2-.9 1.9.6 2.5-4.3-1.5-1.4v-2l1.5-1.4-2.5-4.3-1.9.6-2-.9-.5-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button></div></header>
    <FriendsDialog open={friendsOpen} onClose={() => setFriendsOpen(false)} photos={photos} onPhotos={setSharedPhotos} />
    <InstallNotice />
    {mapMode==='conquest' && <ConquestMap photos={photos} onShowPhotos={showPhotoMap} />}
    <main className={mapMode==='conquest'?'photo-map-hidden':selecting?'is-picking':''}>
      {memoriesOpen && !selecting && <button className="memories-backdrop" aria-label="思い出の一覧を閉じる" onClick={() => setMemoriesOpen(false)} />}
      <aside className={'memories-panel' + (memoriesOpen ? ' is-open' : '') + (drawer.dragOffset !== null ? ' is-dragging' : '')}
        style={{ '--drawer-drag': (drawer.dragOffset ?? 0) + 'px' }} onKeyDown={event => {
        if (event.key === 'Escape') { setMemoriesOpen(false); event.currentTarget.querySelector('.memories-toggle')?.focus(); }
      }}>
        <button className="memories-toggle" aria-expanded={memoriesOpen} aria-controls="memories-list" {...drawer.handleProps}>
          <span className="sheet-handle" aria-hidden="true" />
          <span className="sheet-title">思い出</span><span className="sheet-count">{photoCount(photos.length, sharedPhotos.length)}</span><span className="sheet-chevron" aria-hidden="true">{memoriesOpen ? '⌄' : '⌃'}</span>
        </button>
        <div className="intro"><span className="eyebrow">YOUR PERSONAL ATLAS</span><h1>ここにいた、<br />を残そう。</h1><p>いつもの道も、初めての街も。<br />写真から広がる、あなただけの地図。</p></div>
        <div className="section-title"><h2>思い出</h2><span>{photoCount(photos.length, sharedPhotos.length)}</span></div>
        {/* Newest first, with a heading for each month that stays at the top while its photos scroll by. */}
        <div className="list" id="memories-list" {...drawer.listProps}>{mapPhotos.length ? months.map(month => <React.Fragment key={month.key}>
          {showMonthHeadings(months) && <h3 className="list-month">{month.label}<small>{month.photos.length}枚</small></h3>}
          {month.photos.map(photo =>
          <button key={photo.id} className="memory" onClick={() => openPhoto(photo)} disabled={selecting}>
            <Photo blob={photo.blob} thumb={192} alt={photo.caption || '思い出の写真'} />
            <span>{photo.caption || '名前のない思い出'}<small>{photo.shared ? '友達の写真 · ' : ''}{date(photo.createdAt)}</small></span>
          </button>)}</React.Fragment>) : <p className="empty">{ready ? 'まだ写真がありません。最初の一枚を撮ってみましょう。' : '保存した写真を読み込んでいます…'}</p>}</div>
        <p className="privacy">写真はこの端末のブラウザに保存されます。大切な写真はバックアップしてください。</p>
      </aside>
      <section className={'map-wrap' + (selecting ? ' is-picking' : '')} aria-label="写真の地図">
        <PhotoMap photos={mapPhotos} onOpen={openPhoto} onOpenGroup={setPlacePhotos} onCenter={reportCenter} selecting={selecting} view={view} currentLocation={currentLocation} fitRequest={fitRequest} onError={notify} />
        {ready && !mapPhotos.length && !selecting && <div className="map-empty">
          <Icon name="pin" size={28} />
          <h2>撮った場所に、写真を残す地図</h2>
          <p>下の「写真を追加」から始めましょう</p>
        </div>}
        <div className="map-tools"><button className="has-icon icon-only" title="すべて表示" onClick={() => mapPhotos.length ? setFitRequest(value => value + 1) : notify('写真を保存すると地図上に表示されます。')}><IconLabel icon="fit" label="すべて表示" /></button></div>
        <button className="locate-fab" disabled={locating} onClick={locate} aria-label={locating ? '現在地を取得中' : '現在地を表示'} title="現在地を表示" aria-busy={locating}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
            <path d="M12 1v4m0 14v4M1 12h4m14 0h4" />
          </svg>
        </button>
        {selecting && <>
          <div className="pick-target" aria-hidden="true"><Icon name="pin" size={40} /></div>
          <p className="pick-hint" id="pick-hint">地図を動かして、<span className="phrase">印を保存する場所に</span><span className="phrase">合わせてください</span></p>
          {/* The two buttons sit at the bottom, where the thumb reaches (where "写真を追加" was). */}
          <div id="place-hint" className="pick-actions" role="group" aria-label="保存場所を選ぶ" aria-describedby="pick-hint">
            <button className="has-icon" onClick={() => setSelecting(false)}><IconLabel icon="close" label="やめる" short="やめる" /></button>
            <button className="primary has-icon" onClick={pickPlace}><IconLabel icon="check" label="ここに決める" short="決める" /></button>
          </div>
        </>}
        {!selecting && <div className="capture-bar"><button className="primary has-icon" disabled={!ready || busy} onClick={addPhoto}>{busy ? '処理中…' : <IconLabel icon="camera" label="＋ 写真を追加" short="写真を追加" />}</button><span>今日の景色を、思い出に。</span></div>}
      </section>
    </main>
    <input ref={cameraFile} type="file" accept="image/*" capture="environment" hidden onChange={event => capture(event, 'camera')} />
    <input ref={albumFile} type="file" accept="image/*" hidden onChange={event => capture(event, 'album')} />
    {sourceOpen && <Modal title="写真を追加" className="photo-source-sheet" onClose={() => setSourceOpen(false)}>
      <div className="photo-source-actions">
        <button className="primary has-icon" onClick={() => pickSource(cameraFile)}><IconLabel icon="camera" label="カメラで撮る" short="カメラ" /></button>
        <button className="has-icon" onClick={() => pickSource(albumFile)}><IconLabel icon="album" label="アルバムから選ぶ" short="アルバム" /></button>
        <button className="quiet" onClick={() => setSourceOpen(false)}>やめる</button>
      </div>
    </Modal>}
    <p id="status" role="status" aria-live="polite">{status}</p>
    {settingsOpen && <Modal title="設定" className="settings-dialog" busy={importing || exporting} onClose={() => setSettingsOpen(false)}>
      <button className="settings-item" disabled={!ready || exporting || importing} onClick={backup}>
        <span className="has-icon"><Icon name="download" />{exporting ? '保存しています…' : 'バックアップを保存'}</span>
        <small>写真と場所、ひとことをファイルに保存します</small>
        {/* When the last backup was made sits inside the button it belongs to, one line less in the dialog. */}
        {photos.length > 0 && <small className={'settings-last' + (backupState.at === null || unbackedCount(backupState, photos.length) ? ' is-due' : '')}>{backupState.at === null ? 'まだ一度も保存していません'
          : '前回：' + date(backupState.at) + (unbackedCount(backupState, photos.length) ? '・そのあと増えた写真 ' + unbackedCount(backupState, photos.length) + '枚' : '')}</small>}
      </button>
      <input ref={importFile} type="file" accept=".json,application/json" hidden onChange={importBackup} />
      <button className="settings-item" disabled={!ready || exporting || importing} onClick={() => importFile.current.click()}>
        <span className="has-icon"><Icon name="upload" />{importing ? '戻しています…' : 'バックアップから戻す'}</span>
        <small>前に保存したファイルから写真を戻します<span className="phrase">（今ある写真は消えません）</span></small>
      </button>
      <p className="settings-result" role="status" aria-live="polite">{settingsMessage}</p>
      <p className="settings-note"><span className="phrase">写真はこのブラウザだけにあります。</span><span className="phrase">ときどき保存しておきましょう。</span></p>
    </Modal>}
    {pending && !selecting && <Modal title="思い出を保存" className="save-dialog" onClose={cancel} busy={busy}>
      <form onSubmit={save}>
        <div className={'save-visuals' + (Number.isFinite(pending.lat) ? ' has-map' : '')}>
          <Photo className="save-photo" blob={pending.blob} alt="撮影した写真" />
          {Number.isFinite(pending.lat) && <PlacePreview lat={pending.lat} lng={pending.lng} blob={pending.blob} />}
        </div>
        {Number.isFinite(pending.lat) ? <>
          <p id="location-label"><Icon name="pin" size={16} />{placeLabel(pending)}<span className="visually-hidden">。保存場所：緯度 {pending.lat.toFixed(5)}、経度 {pending.lng.toFixed(5)}</span></p>
          {pending.noPhotoPlace && <p className="location-note">写真に撮影場所の情報がなかったので、現在地を入れました。</p>}
        </> : <p id="location-label">{(pending.locationProblem || '') + (pending.noPhotoPlace ? '写真に撮影場所の情報もありませんでした。' : '') + '保存する場所を地図で選んでください。'}</p>}
        {pending.accuracy > 100 && <p className="location-warning">現在地が実際の場所とずれているかもしれません。違うときは「選び直す」で直してください。</p>}
        <button type="button" className="quiet has-icon" disabled={busy} onClick={startPicking}><IconLabel icon="pin" label="地図で場所を選び直す" short="選び直す" /></button>
        <label>ひとこと<input value={pending.caption} disabled={busy} maxLength={100} placeholder="例：帰り道で見つけた夕焼け" onChange={event => setPending({ ...pending, caption: event.target.value })} /></label>
        <button id="save" className="primary has-icon" disabled={busy || !Number.isFinite(pending.lat)} type="submit">{busy ? '保存中…' : <IconLabel icon="check" label="この場所に保存" short="保存" />}</button>
      </form>
    </Modal>}
    {placePhotos && <Modal title={'この辺りの写真 ' + placePhotos.length + '枚'} className="place-photos" onClose={() => setPlacePhotos(null)}>
      <div className="place-photo-list">{placeMonths.map(month => <React.Fragment key={month.key}>
        {showMonthHeadings(placeMonths) && <h3 className="list-month">{month.label}<small>{month.photos.length}枚</small></h3>}
        {month.photos.map(photo =>
        <button key={photo.id} className="memory" onClick={() => { setPlacePhotos(null); openPhoto(photo); }}>
          <Photo blob={photo.blob} thumb={192} alt="" />
          <span>{photo.caption || '名前のない思い出'}<small>{photo.shared ? '友達の写真 · ' : ''}{date(photo.createdAt)}</small></span>
        </button>)}</React.Fragment>)}</div>
    </Modal>}
    {active && <Modal title={active.caption || '名前のない思い出'} className="detail-dialog" onClose={() => setActive(null)} busy={busy}>
      <Photo blob={active.blob} alt={active.caption || '思い出の写真'} /><p id="detail-date">{date(active.createdAt)}</p>
      <button className="quiet has-icon icon-only" title="写真をダウンロード" onClick={() => download(active.blob, 'memory-' + active.id + '.jpg')}><IconLabel icon="download" label="写真をダウンロード" /></button>
      {active.shared ? <p className="settings-note">友達が共有した写真です。</p> : <button className="danger has-icon" disabled={busy} onClick={() => setConfirmingDelete(true)}><IconLabel icon="trash" label="この写真を削除" short="削除" /></button>}
    </Modal>}
    {active && confirmingDelete && <ConfirmDialog title="この写真を削除しますか？" text="このブラウザから消え、元に戻せません。"
      confirmLabel="削除する" busyLabel="削除中…" busy={busy} onCancel={() => setConfirmingDelete(false)} onConfirm={remove} />}
  </>;
}
