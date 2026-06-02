# Yaniv Scorer

ヤニブ専用の得点計算機（Web版）。Vite + React。

## 特長

- **複数プレイヤー対応**（2〜8人）
- **ラウンドごとに「誰→誰に何点」を入力**するだけ
- **リアルタイム折れ線グラフ**で累計点の推移を表示
- **リプレイ機能**：ラウンドごとに線が伸びていくアニメーション（画面録画推奨）
- **結果のスクショ保存**：最終順位＋グラフをPNGでダウンロード
- **localStorageで自動保存**：リロード・タブを閉じても続行可能（同じブラウザなら半永久的に保持）
- **過去ゲームの履歴**：完了したゲームは自動で履歴に記録され、後から順位・グラフ・リプレイを確認可能
- **PWA対応**：iPhoneのSafariで「ホーム画面に追加」するとアプリのように使える

## ローカル起動

```bash
npm install
npm run dev
```

ブラウザで http://localhost:5173 にアクセス。

## Vercelへのデプロイ

### 方法1: GitHub経由（推奨）

1. このプロジェクトをGitHubにpush
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git remote add origin <あなたのリポジトリURL>
   git push -u origin main
   ```
2. [Vercel](https://vercel.com) にアクセスしてGitHubでログイン
3. 「Add New Project」→ リポジトリを選択
4. Framework Preset は自動で `Vite` が選ばれる。そのままデプロイ
5. 数十秒で `https://<プロジェクト名>.vercel.app` にデプロイ完了

### 方法2: Vercel CLI（最速）

```bash
npm install -g vercel
vercel
```

質問に答えていくと数十秒でデプロイされる。

## iPhoneのホーム画面に追加

1. デプロイしたURLをSafariで開く（Chromeでは不可）
2. 共有ボタン → 「ホーム画面に追加」
3. アイコンから起動するとフルスクリーンのアプリとして動く

## データ保存について

- ブラウザの `localStorage` に保存される（同じブラウザならリロード・タブクローズ・再起動しても残る）
- 進行中ゲームと過去ゲーム履歴を別々に管理
- 過去ゲームは「結果を見る」を押した時点で自動的に履歴に追加される
- 履歴は古いものから順に並び、いつでも詳細（順位・グラフ・リプレイ）を確認可能
- 完全に消したい場合は履歴一覧から個別削除、または各画面の「新規ゲーム」「リセット」

## カスタマイズ

- プレイヤーカラー: `src/App.jsx` の `PLAYER_COLORS` 配列
- 配色・フォント: `src/App.jsx` の `styles` オブジェクト
- リプレイ速度: `App.jsx` の `setInterval(..., 700)` の数値（ms）

## 技術スタック

- Vite 5
- React 18
- recharts（グラフ）
- html-to-image（スクショ書き出し）
