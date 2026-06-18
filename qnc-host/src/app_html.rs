pub const APP_HTML: &str = r#"<!DOCTYPE html>
<html lang="hr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Quick News Cutter</title>
  <link rel="stylesheet" href="/app/shell/app.css?v=3"/>
  <link rel="stylesheet" href="/app/shell/qnc-shell.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-theme.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-components.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-cards.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-layout.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-editorial.css?v=2"/>
</head>
<body class="qshell qshell-v2">
  <div class="qmain">
    <div class="tab-widget">
      <div id="qnc-plugin-panels" class="qtab-pane"></div>
      <nav class="qtab-footer" role="tablist" aria-label="Moduli">
        <span id="active-project-label" class="qtab-footer-project" title="Aktivni projekt">Projekt: —</span>
        <div class="qtab-footer-tabs"></div>
        <select id="qnc-server-host" class="qcombo qcombo-footer" title="QNC server" aria-label="QNC server"></select>
      </nav>
    </div>
  </div>

  <div id="log-modal" class="log-modal" hidden>
    <div class="log-modal-backdrop" data-log-close></div>
    <div class="log-modal-panel" role="dialog" aria-labelledby="log-modal-title">
      <header class="log-modal-header">
        <h3 id="log-modal-title">Process log</h3>
        <button type="button" class="qbtn" id="log-modal-close" data-log-close>Zatvori</button>
      </header>
      <div id="log-modal-body" class="shell-log log-modal-body"></div>
    </div>
  </div>

  <script src="/app/shell/qnc-core.js?v=8"></script>
  <script src="/app/shell/qnc-shell.js?v=6"></script>
  <script src="/app/shell/qnc-bus.js?v=2"></script>
  <script src="/app/shell/qnc-tab-registry.js?v=4"></script>
  <script src="/app/shell/qnc-plugin-sdk.js?v=1"></script>
  <script src="/app/shell/app.js?v=12"></script>
</body>
</html>"#;
