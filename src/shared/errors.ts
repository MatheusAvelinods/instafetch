/**
 * Converte códigos de erro do chrome.downloads (DownloadInterruptReason)
 * em mensagens compreensíveis.
 */
const MESSAGES: Record<string, string> = {
  SERVER_FORBIDDEN: "Acesso negado pelo servidor. O link pode ter expirado — recarregue a página e tente de novo.",
  SERVER_UNAUTHORIZED: "Acesso negado. Esta mídia exige permissão que você não tem.",
  SERVER_BAD_CONTENT: "Mídia indisponível ou removida.",
  SERVER_FAILED: "O servidor do Instagram não respondeu corretamente. Tente novamente.",
  SERVER_NO_RANGE: "O servidor não permitiu retomar o download. Tente novamente.",
  SERVER_CERT_PROBLEM: "Problema de segurança na conexão com o servidor.",
  SERVER_CONTENT_LENGTH_MISMATCH: "O arquivo chegou incompleto. Tente novamente.",
  SERVER_CROSS_ORIGIN_REDIRECT: "O servidor redirecionou para outro endereço. Recarregue a página.",
  NETWORK_FAILED: "Falha de rede. Verifique sua conexão.",
  NETWORK_TIMEOUT: "A conexão demorou demais. Tente novamente.",
  NETWORK_DISCONNECTED: "Sem conexão com a internet.",
  NETWORK_SERVER_DOWN: "Servidor fora do ar. Tente mais tarde.",
  NETWORK_INVALID_REQUEST: "Link inválido. Recarregue a página e tente de novo.",
  FILE_ACCESS_DENIED: "Sem permissão para salvar na pasta de downloads.",
  FILE_NO_SPACE: "Sem espaço em disco.",
  FILE_NAME_TOO_LONG: "Nome de arquivo longo demais.",
  FILE_TOO_LARGE: "Arquivo grande demais para o sistema de arquivos.",
  FILE_VIRUS_INFECTED: "O arquivo foi bloqueado pelo antivírus.",
  FILE_BLOCKED: "O download foi bloqueado pelo Chrome ou por uma política do sistema.",
  FILE_SECURITY_CHECK_FAILED: "O Chrome bloqueou o arquivo na verificação de segurança.",
  FILE_FAILED: "Não foi possível gravar o arquivo.",
  FILE_TRANSIENT_ERROR: "Erro temporário ao gravar o arquivo. Tente novamente.",
  CRASH: "O navegador foi encerrado durante o download.",
  USER_SHUTDOWN: "O navegador foi encerrado durante o download.",
};

export function friendlyDownloadError(code: string | undefined): string {
  if (!code) return "Falha desconhecida no download.";
  return MESSAGES[code] ?? `Falha no download (${code}).`;
}

export function friendlyStartError(message: string | undefined): string {
  if (!message) return "Não foi possível iniciar o download.";
  if (/invalid url/i.test(message)) return "Link inválido para download.";
  if (/filename/i.test(message)) return "Nome de arquivo inválido.";
  return `Não foi possível iniciar o download: ${message}`;
}
