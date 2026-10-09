# Memory Map
React + Vite + Leafletで作る写真地図アプリです。サーバー処理・ログインはありません。

## 開発
Node.js 22.12以上（推奨24）を使います。
```sh
npm install
npm run dev
```
表示されたURLを開いてください。公開用ビルドは `npm run build`、ビルド確認は `npm run preview`、保存処理のテストは `npm test` です。

## GitHub Pages
**Settings → Pages → Build and deployment → Source を「GitHub Actions」に変更してください。**
以前の「Deploy from a branch」のままではReactのソースを表示できません。
設定後、Actionsの「Build and deploy Memory Map」で「Run workflow」を実行してください。以降はmainへのpushでテスト・ビルド・公開が実行されます。
公開先: https://mamamaki12.github.io/memory-map/
Viteのbaseは `/memory-map/` に設定済みです。別のリポジトリ名で使う場合は変更してください。
ワークフローのビルドが成功しても、Pagesが未設定なら公開ジョブは失敗します。設定してから再実行してください。

## 機能
- スマートフォンの撮影画面（端末によっては画像選択）を開き、現在地に写真付きピンを保存
- 位置取得に失敗した場合は地図上で場所を選択
- 写真の一覧・拡大・削除・個別ダウンロード・JSONバックアップ
- モバイル対応

## データ
IndexedDBの名前 `memory-map`、バージョン1、ストア `photos` は旧版と同じです。同じブラウザ・同じ公開元なら既存の写真を引き継ぎます。
写真は長辺1600px以下のJPEGに変換し、この端末のブラウザだけに保存します。サーバーや他端末には同期しません。
ブラウザのデータ削除で写真は消えます。バックアップの復元UIはありません。
選択した画像のEXIF位置情報は読み取らず、選択時の現在地を使用します。必要なら地図上で変更してください。
撮影・位置情報にはHTTPS（開発時はlocalhost）が必要です。実機のカメラと権限動作は公開後に確認してください。
地図タイルはOpenStreetMapから取得するため、インターネット接続が必要です。ReactとLeafletはビルド成果物に含まれ、CDNスクリプトには依存しません。

## 構成
- src/App.jsx: 画面・撮影と保存の状態管理
- src/PhotoMap.jsx: Leaflet地図と写真ピン、イベント・URLの後片付け
- src/storage.js: 既存データと互換性のあるIndexedDB操作
- src/media.js: 位置取得・画像縮小・ダウンロード
- src/style.css: デザイン
- test/storage.test.js: 保存・再読込・削除・中断のテスト
- .github/workflows/deploy.yml: テスト・ビルド・Pages公開
