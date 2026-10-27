# Política de privacidade — InstaFetch

O InstaFetch funciona **inteiramente no seu navegador**.

- **Não coleta nem envia dados.** Nenhuma URL, mídia, credencial ou informação de uso é enviada para servidores do desenvolvedor ou de terceiros. A extensão não tem backend.
- **Não pede senha nem login.** Ela apenas lê o que a página do Instagram já carregou na sua sessão.
- **Armazenamento local:** em `chrome.storage.local` ficam suas preferências e o histórico de downloads (nome do arquivo, tipo, código da publicação, data e o id do download no Chrome). Links assinados do CDN **não** são guardados no histórico. A fila em andamento fica em `chrome.storage.session`, que é apagado ao fechar o navegador.
- Você pode limpar o histórico a qualquer momento pela aba **Histórico**. Desinstalar a extensão remove todos os dados.

## Permissões

| Permissão | Por quê |
| --- | --- |
| `downloads` | Salvar os arquivos, acompanhar o progresso, cancelar e mostrar o arquivo na pasta. |
| `storage` | Guardar preferências, histórico e o estado da fila. |
| `activeTab` | Saber se a aba aberta é do Instagram quando você clica no ícone. |
| Content scripts em `https://www.instagram.com/*` | Identificar as mídias da página. Não há acesso a nenhum outro site. |

## Uso responsável

Baixe apenas conteúdo seu ou que você tenha permissão para salvar. A extensão não contorna conteúdo privado, login, DRM ou outras proteções: ela só enxerga o que a sua própria conta já pode ver.
