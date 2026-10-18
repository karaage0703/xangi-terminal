// A backend report, not a command-name allowlist or a shell executor.
export function previewReport(result, cwd, toolCount) {
  if (!['executed', 'dry-run', 'predicted', 'unavailable'].includes(result.status) || typeof result.reason !== 'string' || !result.reason.trim() || result.reason.length > 8000 || result.reason.includes('\0')) throw Error('確認結果の状態・理由が不正です。');
  if (!Array.isArray(result.checks) || result.checks.length > 20) throw Error('確認手順の形式が不正です。');
  for (const check of result.checks) {
    for (const field of ['command', 'cwd', 'output']) if (typeof check[field] !== 'string' || check[field].length > 8000 || check[field].includes('\0')) throw Error('確認手順の形式が不正です。');
    if (check.exitCode !== null && !Number.isInteger(check.exitCode)) throw Error('確認手順の終了コードが不正です。');
  }
  const exact = result.checks.find(c => c.command === result.command && c.cwd === cwd && Number.isInteger(c.exitCode));
  if (result.status === 'executed' && !exact) throw Error('候補と作業フォルダが一致する実行報告がありません。');
  if (result.status === 'dry-run' && !result.checks.length) throw Error('dry-runの確認報告がありません。');
  const claimedExecution = ['executed', 'dry-run'].includes(result.status);
  const previewKind = claimedExecution && !toolCount ? 'unverified' : result.status;
  const output = result.status === 'executed' ? (exact.output || `出力はありません（終了コード ${exact.exitCode}）。`) : result.status === 'unavailable' ? result.reason : result.simulation;
  const trace = toolCount ? `ツール呼び出し履歴 ${toolCount}件を確認。出力・終了コードはバックエンドの報告です。` : 'ツール呼び出し履歴を確認できていません。確認内容はバックエンドの報告のみです。';
  return { simulation: output, previewKind, previewNote: result.reason + ' ' + trace, previewCwd: cwd,
    evidenceSource: trace, evidence: result.evidence + result.checks.map(c => `\n\n${c.cwd}\n$ ${c.command}\n終了コード: ${c.exitCode ?? '未確認'}\n${c.output || '（出力なし）'}`).join('') };
}
