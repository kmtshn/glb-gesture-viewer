# WebAR Viewer 🌐

GLBファイルをブラウザ上でARに配置できるWebARアプリです。  
Three.js + WebXR Device API (Hit Test) を使用して、現実世界の平面上に3Dモデルをリアルタイムに設置できます。

## ✨ 機能

- 📂 **GLBファイルのアップロード** – ローカルのGLB/GLTFファイルをドラッグ&ドロップまたはファイル選択で読み込み
- 📱 **WebXR ARセッション** – Android Chrome の WebXR API でARカメラを起動
- 🎯 **Hit Test 平面認識** – 床・机などの水平面をリアルタイムで検出し、レティクル（照準）を表示
- 👆 **タップ設置** – レティクル位置にGLBモデルを配置（何度でも追加可能）
- 🔄 **リセット機能** – 配置済みモデルを一括削除

## 🚀 開発環境の起動

```bash
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開いてください。

## 📱 実機でのAR動作テスト

WebXRはHTTPS環境が必要です。ローカルで実機テストする場合：

```bash
# 方法1: ngrok でHTTPSトンネルを作成
npm run dev
ngrok http 5173

# 方法2: vite の --https オプション（自己署名証明書）
npx vite --https
```

## 🏗️ ビルド & デプロイ

```bash
# GitHub Pages 用にビルド
VITE_BASE_PATH=/your-repo-name/ npm run build

# ビルド結果をローカルでプレビュー
npm run preview
```

## 📦 GitHub Pages へのデプロイ設定

1. GitHub リポジトリの **Settings > Pages** を開く
2. **Source** を `GitHub Actions` に設定
3. リポジトリ名を `vite.config.js` の `base` に設定（または環境変数 `VITE_BASE_PATH` で自動設定）
4. `main` ブランチにプッシュすると自動デプロイ 🎉

## 🛠️ 技術スタック

| 技術 | 用途 |
|------|------|
| [Three.js](https://threejs.org/) | 3Dレンダリング |
| [WebXR Device API](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API) | ARセッション管理 |
| [Vite](https://vitejs.dev/) | ビルドツール |
| GLTFLoader | GLB/GLTFファイルの読み込み |

## 📋 対応環境

| プラットフォーム | ブラウザ | AR対応 |
|-----------------|---------|--------|
| Android | Chrome 79+ | ✅ |
| iOS | Safari 16+ | ⚠️ 制限あり |
| Windows/Mac | Chrome | ❌ (UI確認のみ) |

> **Note**: WebXR Hit Test は現在 Android Chrome での動作が最も安定しています。

## 🎲 サンプルGLBの生成

```bash
node scripts/generate-dummy-glb.js
```

`public/sample.glb` に立方体のGLBが生成されます。
