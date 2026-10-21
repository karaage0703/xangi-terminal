# xangi-terminalのセットアップ

## 前提

LinuxまたはmacOS、Node.js 22以上、bashが必要です。node-ptyのネイティブビルドにC++ビルドツールが必要になる場合があります。xangi拡張として利用するときは、同じ端末でxangiを起動しておきます。macOSでは標準の`/bin/bash`と`/usr/sbin/lsof`を使います。node-ptyのビルドに必要な場合はCommand Line Tools（`xcode-select --install`）を導入してください。

macOSでは`npm ci`のpostinstallでnode-pty 1.1.0付属のspawn-helperに実行権限を付けます。インストールスクリプトを無効化した場合は、`node scripts/prepare-pty.mjs`を実行してから起動してください。sudoは不要です。

拡張モードでは、xangiがターミナルを起動し、本体と同じポートで画面・API・WebSocketを中継します。別途 `npm start` を起動する必要はありません。内部ポートはloopbackへ自動割当されます。この方式にはWebSocket中継対応版のxangiが必要です。既存の単独サーバーを自動停止したり、.envを上書きしたりしません。

## サーバーの準備と起動

リポジトリのルートで実行します。

```sh
npm ci
# 初回だけ。既存の.envがある場合はコピーしません。
cp .env.example .env
```

`.env`を環境に合わせて設定します。

- `HOST`（単独起動のみ）: 既定は`127.0.0.1`。
- `PORT`（単独起動のみ）: 既定は`18920`。既存サービスとの重複を確認します。
- `ORIGIN`（単独起動のみ）: ブラウザから使うURL。ローカルなら`http://127.0.0.1:18920`。リバースプロキシを使う場合は、そのURLと完全一致させます。
- `XANGI_URL`: xangi Web UIの接続先。例は`http://127.0.0.1:18888`です。実際の待受先を確認してください。tool-serverのURLではありません。
- `XANGI_TOKEN`: xangi側がBearer認証を要求する場合だけ設定します。

xangi連携時は設定画面でエージェントを選び、そのワークスペース・指示・AI設定を使用します。初回はxangiの既定エージェント、以後はサーバーに保存されたエージェントです。ターミナルの最初の実行先は本体の既定ワークスペースで、AIの起動先とは別です。独自のLLM設定は不要です。単独利用の場合だけ`CWD`と必要に応じて`LLM_BASE_URL`・`LLM_MODEL`などを設定します。詳しくは[使い方・設定](docs/usage.md)を参照してください。

### 専用エージェントを用意する場合（任意）

日常業務用のAGENTS.mdを継承しないよう、borotなど既存ワークスペースの**外**に専用フォルダを作ります。親ディレクトリのAGENTS.mdやCLIのグローバル指示も確認してください。既存フォルダを使う場合は指示ファイルを上書きせず内容を確認します。

```sh
mkdir -p "$HOME/xangi-workspaces/xangi-terminal"
cp templates/ai-workspace/AGENTS.md "$HOME/xangi-workspaces/xangi-terminal/AGENTS.md"
ln -s AGENTS.md "$HOME/xangi-workspaces/xangi-terminal/CLAUDE.md"
xangi tool help workspace
xangi tool workspace --action list
xangi tool workspace --action create --name xangi-terminal --path "$HOME/xangi-workspaces/xangi-terminal"
```

既に登録済みならそのIDを再利用します。xangiのエージェント設定で「xangi-terminal」などのエージェントを作り、このワークスペースを割り当てます。terminalの「設定 → エージェント」でそれを選びます。ワークスペースIDをterminalの.envへ設定する必要はありません。既存のエージェントも選択できます。

専用フォルダに置くのはAIの指示です。画面の作業フォルダ切替や`cd`はコマンドの実行対象だけを変え、AI起動先を変えません。AIの事前確認も依頼JSONの`cwd`を明示して実行します。

単独利用の場合だけ起動します。拡張として使う場合は次の登録へ進みます。

```sh
npm start
```

サーバー用キーは初回に`.runtime/access-token`へ自動生成されます（0600、Git対象外）。キーをブラウザへ貼り付ける操作はありません。

常駐させる場合は既存のプロセス管理方法を使います。PM2ではNodeバイナリを`script`、`interpreter: 'none'`、引数を`['--env-file=.env','src/server.mjs']`とし、cwdをこのcheckoutへ指定します。Nodeの実在パスは`command -v node`で確認します。PM2のESMラッパーでsrc/server.mjsを直接importすると、待受を開始しません。

## xangi拡張への登録

```sh
xangi extension link /absolute/path/to/xangi-terminal/xangi-extension.json
xangi extension start xangi-terminal
xangi extension status xangi-terminal
```

`/absolute/path/to/xangi-terminal`は実際のcheckoutに置き換えます。拡張はそのcheckoutの`.env`を読みます。`XANGI_URL`が未設定なら本体から渡された接続先を使用します。`HOST`・`PORT`・`ORIGIN`・`TERMINAL_TOKEN`は拡張モードでは使いません。

xangiの拡張一覧から「開く」を押すと、本体配下の `/api/extensions/xangi-terminal/service/` へ接続します。内部トークンはブラウザへ渡さず、セッションCookieは拡張専用パスに保存します。「xangiホーム」で元のホームに戻れます。拡張停止時はその拡張が起動したPTYも終了します。

## ブラウザからの接続

拡張モードではスマホ・別PCもxangi本体のURLだけを使います。本体へアクセスできる利用者がterminalを操作できるため、本体の公開範囲を制限してください。HTTPSプロキシを使う場合は本体へのWebSocket転送も有効にします。

単独利用は従来どおり `npm start` と `npm run open` を使います。別端末用の `ORIGIN`、本人自動認証の `TRUSTED_TAILSCALE_LOGIN`、一度限りのリンクは単独モードの設定です。詳しくは[接続と権限](docs/usage.md#接続と権限)を参照してください。

## 導入後の確認

- 拡張のstatusが正常で、xangiの拡張一覧からキー入力なしで接続できる。
- ターミナルで`pwd`を実行でき、想定した作業フォルダになっている。
- 「設定」にxangiのエージェント一覧が表示され、選択が再読み込み後も保持される。
- 「xangiホーム」で元の画面へ戻れる。

日常の操作は[使い方](docs/usage.md)、構成と認証の詳細は[設計](docs/design.md)を参照してください。
