# xangi-terminalのセットアップ

## 前提

LinuxまたはmacOS、Node.js 22以上、bashが必要です。node-ptyのネイティブビルドにC++ビルドツールが必要になる場合があります。xangi拡張として利用するときは、同じ端末でxangiを起動しておきます。macOSでは標準の`/bin/bash`と`/usr/sbin/lsof`を使います。node-ptyのビルドに必要な場合はCommand Line Tools（`xcode-select --install`）を導入してください。

macOSでは`npm ci`のpostinstallでnode-pty 1.1.0付属のspawn-helperに実行権限を付けます。インストールスクリプトを無効化した場合は、`node scripts/prepare-pty.mjs`を実行してから起動してください。sudoは不要です。

ターミナルサーバーと拡張の接続窓口は別プロセスです。サーバーを先に起動し、同じcheckoutの拡張を登録します。既存のサーバーや設定がある場合は再利用し、二重起動や.envの上書きを避けてください。

## サーバーの準備と起動

リポジトリのルートで実行します。

```sh
npm ci
# 初回だけ。既存の.envがある場合はコピーしません。
cp .env.example .env
```

`.env`を環境に合わせて設定します。

- `HOST`: 既定は`127.0.0.1`。
- `PORT`: 既定は`18920`。既存サービスとの重複を確認します。
- `ORIGIN`: ブラウザから使うURL。ローカルなら`http://127.0.0.1:18920`。リバースプロキシを使う場合は、そのURLと完全一致させます。
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

`/absolute/path/to/xangi-terminal`は実際のcheckoutに置き換えます。拡張はそのcheckoutの`.env`を読み、同じ端末のterminalへloopbackで接続します。ターミナルのキーは`TERMINAL_TOKEN`または同じcheckoutの`.runtime/access-token`を使います。

xangiの拡張一覧から「開く」を押します。認証された拡張の接続窓口が60秒・一度限りのリンクを発行し、ターミナルへ自動接続します。ヘッダーの「xangiホーム」で元のホームに戻れます。拡張の停止・再起動だけでは、別途起動したターミナルサーバーは停止・再起動しません。

## ブラウザからの接続

スマホ・別PCでは、ブラウザから到達できるterminalのURLを`ORIGIN`へ設定します。TailnetのHTTPSリバースプロキシを使う場合はHost・WebSocketを転送してください。xangiの拡張入口にアクセスできる利用者がterminalにも接続できるため、xangi側の公開範囲で利用者を制限します。

Tailscale本人自動認証も使う場合は`TRUSTED_TAILSCALE_LOGIN`を設定します。認証の前提は[接続と権限](docs/usage.md#接続と権限)を参照してください。

単独でローカル利用する場合は、別のターミナルで同じcheckoutから`npm run open`を実行します。一度限りのリンクをOSのブラウザで開きます。別PCからは`ssh -L 18920:127.0.0.1:18920 user@server`での接続も可能です。

## 導入後の確認

- 拡張のstatusが正常で、xangiの拡張一覧からキー入力なしで接続できる。
- ターミナルで`pwd`を実行でき、想定した作業フォルダになっている。
- 「設定」にxangiのエージェント一覧が表示され、選択が再読み込み後も保持される。
- 「xangiホーム」で元の画面へ戻れる。

日常の操作は[使い方](docs/usage.md)、構成と認証の詳細は[設計](docs/design.md)を参照してください。
