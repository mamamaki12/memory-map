import React, { useEffect, useState } from 'react';
function standalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches || navigator.standalone === true;
}
export default function InstallNotice() {
  const [hidden, setHidden] = useState(standalone);
  const [prompt, setPrompt] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const mode = window.matchMedia('(display-mode: standalone)');
    const changed = () => { if (standalone()) setHidden(true); };
    const available = event => { event.preventDefault(); setPrompt(event); };
    const installed = () => { setHidden(true); setPrompt(null); };
    mode.addEventListener('change', changed);
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', installed);
    return () => {
      mode.removeEventListener('change', changed);
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  if (hidden) return null;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function install() {
    if (!prompt) { setHelp(value => !value); return; }
    setInstalling(true);
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === 'accepted') setHidden(true);
    } catch { setHelp(true); }
    finally { setPrompt(null); setInstalling(false); }
  }
  return <section className="install-notice" aria-label="ホーム画面への追加">
    <div className="install-message"><strong>ホーム画面に追加してください</strong>
      <p>思い出の地図を、アプリのようにすぐ開けます。</p>
      {help && <p>{ios ? '共有メニュー →「ホーム画面に追加」→「追加」を選んでください。項目がない場合はSafariで開いてください。' : 'ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。項目がない場合はChromeなどの対応ブラウザで開いてください。'}</p>}
    </div>
    <button className="quiet" disabled={installing} onClick={install}>{prompt ? '追加する' : '追加方法'}</button>
    <button className="install-dismiss" aria-label="追加案内を閉じる" onClick={() => setHidden(true)}>×</button>
  </section>;
}
