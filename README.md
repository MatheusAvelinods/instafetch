# InstaFetch

Extensão para Google Chrome (Manifest V3) que identifica, seleciona e baixa imagens e vídeos do Instagram, individualmente ou em lote, com fila controlada, histórico e tratamento de erros. Tudo roda localmente: sem servidor, sem cadastro e sem pedir senha.

> Use apenas com conteúdo seu ou que você tenha permissão para baixar. Respeite os direitos autorais e os termos do Instagram.

<!-- Demonstração: grave um GIF do fluxo (abrir post → selecionar → baixar) e salve em docs/demo.gif -->
<!-- ![Demonstração](docs/demo.gif) -->

## Funcionalidades

- **Identificação de mídias:** imagens e vídeos da página aberta, incluindo todos os itens de carrosséis, sempre na maior resolução disponível, sem duplicatas.
- **Prévia:** miniaturas com tipo, resolução e tamanho estimado.
- **Botão na própria página (novo na 1.1):** um botão ⬇ aparece no canto de cada foto ou vídeo do Instagram, no feed, no perfil, em reels e na publicação aberta. Em carrosséis, só o slide visível tem botão, e ele acompanha a troca de slide. Ao passar o mouse, o botão mostra o que será baixado (ex.: “Baixar foto · 1080×1350 · item 2”). Ele baixa sempre a maior resolução conhecida, mesmo quando a tela mostra uma miniatura. Na grade do perfil, a capa de um reel baixa o vídeo. O botão também mostra o progresso, a conclusão ou o erro. Pode ser desligado em Configurações.
- **Filtro de resolução (novo na 1.1):** *Qualquer*, *≥ 320 px*, *≥ 640 px* ou *≥ 1080 px (HD)*, considerando o maior lado da mídia. Esconde miniaturas e imagens pequenas, informa quantas foram ocultadas e fica salvo para as próximas vezes. “Selecionar todas” respeita o filtro.
- **Download individual:** botão em cada miniatura do popup.
- **Download em lote:** selecionar todas, limpar seleção e baixar as selecionadas.
- **Organização:** `Downloads/InstaFetch/<perfil>_<publicação>/<perfil>_<publicação>_01.jpg` (dá para desativar as subpastas).
- **Fila:** estados *aguardando, baixando, concluído, falhou, cancelado*, progresso por item e do lote, limite de 1 a 5 downloads simultâneos (padrão: 3).
- **Cancelar e repetir:** por item ou de uma vez (“Cancelar tudo” e “Repetir falhas”).
- **Erros compreensíveis:** link expirado, acesso negado, mídia indisponível, falha de rede etc. Uma falha nunca desfaz os itens que já foram concluídos.
- **Histórico:** downloads recentes, com atalho para mostrar o arquivo na pasta e opção de limpar.
- **Tema claro e escuro** automático, conforme o sistema.

## Instalação (modo desenvolvedor)

### Opção 1 — pacote pronto

1. Baixe e descompacte `instafetch.zip`.
2. No Chrome, abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta descompactada (a que contém `manifest.json`).

### Opção 2 — a partir do código

Requisitos: Node.js 20+.

```bash
npm install
```

```bash
npm run build
```

Depois carregue a pasta `dist/` em `chrome://extensions` como no passo 4 acima. Durante o desenvolvimento, `npm run watch` recompila a cada alteração; basta clicar em ↻ na extensão e recarregar a página do Instagram.

## Como usar

**Mais rápido:** passe o mouse sobre uma foto ou vídeo no Instagram e clique no botão ⬇ do canto superior esquerdo.

**Pelo popup (para lotes):**

1. Abra uma publicação, reel ou perfil em `instagram.com`.
2. Clique no ícone do InstaFetch.
3. Use os filtros **Todas / Imagens / Vídeos** e **Resolução mínima** (ex.: ≥ 1080 px para pegar só arquivos grandes).
4. Clique no ícone ⬇ de uma mídia para baixá-la, ou marque várias e clique em **Baixar selecionadas**.
5. Acompanhe na aba **Fila**; os arquivos concluídos aparecem no **Histórico**.

Dicas:

- Abra a publicação na própria página dela (`/p/...` ou `/reel/...`) para ver apenas as mídias daquele post. No feed ou no perfil, a lista mostra tudo o que já foi carregado — use **Atualizar** depois de rolar a página.
- Se a extensão disser “Recarregue a página”, a aba foi aberta antes da instalação: atualize-a (F5).
- Se um download falhar com “link expirado”, recarregue a página do Instagram e use **Repetir falhas**.

## Como funciona

A detecção combina três fontes, de forma tolerante a mudanças no layout:

1. **Dados JSON embutidos na página** (`<script type="application/json">`).
2. **Respostas JSON que o próprio Instagram recebe** enquanto você navega. Um script no contexto da página observa (sem alterar e sem fazer requisições novas) as respostas de `fetch`/`XMLHttpRequest` e repassa ao content script. É daqui que vêm os links diretos de vídeos e todos os itens de carrosséis.
3. **Elementos `<img>` e `<video>` visíveis**, como reserva caso as fontes anteriores mudem.

As mídias são deduplicadas pelo caminho do arquivo no CDN (o mesmo arquivo aparece em vários tamanhos), mantendo a maior versão. Só são aceitos links HTTPS de `*.cdninstagram.com` e `*.fbcdn.net`.

O service worker mantém a fila com concorrência limitada, usa `chrome.downloads` para salvar, acompanha o progresso e guarda o estado em `chrome.storage.session`, de modo que a fila sobrevive quando o Chrome suspende o worker.

## Estrutura do projeto

```
src/
  background/   service worker: fila, mensagens, progresso, persistência
  content/      detecção de mídias (DOM, JSON embutido, page-hook no contexto da página),
                botões sobre as mídias (overlay.ts) e escolha da melhor versão (resolve.ts)
  downloads/    fila de downloads (lógica pura e testável) e adaptador do chrome.downloads
  popup/        interface (HTML, CSS e TypeScript sem framework)
  shared/       tipos, mensagens, nomes de arquivo, validação de URL, mensagens de erro
  storage/      preferências e histórico (chrome.storage.local)
public/         manifest.json e ícones
tests/          testes unitários (Vitest) e de integração (tests/e2e, Playwright)
scripts/        build (esbuild) e geração de ícones
```

Por que sem React/Vite? O popup tem poucas telas e o build com esbuild gera scripts clássicos (IIFE), que é o formato exigido para content scripts — menos dependências e um pacote final de ~30 KB.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run build` | Gera a extensão em `dist/` |
| `npm run watch` | Recompila a cada alteração |
| `npm run typecheck` | Verificação de tipos (TypeScript strict) |
| `npm test` | Testes unitários: fila, concorrência, cancelamento, repetição, extração, deduplicação, nomes de arquivo |
| `npm run test:e2e` | Carrega a extensão no Chromium com uma página simulada do Instagram e testa detecção, seleção, fila, erros e repetição (requer `playwright` com Chromium) |
| `npm run zip` | Gera `instafetch.zip` pronto para instalar |

Para o teste de integração também validar downloads concluídos, aponte o CDN para um servidor HTTPS local com `CDN_MAP=127.0.0.1:8443` (veja os comentários em `tests/e2e/smoke.e2e.cjs`).

## Limitações conhecidas

- **Estrutura do Instagram:** a detecção não depende de classes CSS, mas o Instagram pode mudar o formato dos dados. Quando nada é encontrado, a extensão avisa em vez de falhar silenciosamente.
- **Vídeos em streaming:** alguns vídeos são exibidos via `blob:` (transmitidos em partes) e não têm um arquivo único na página. Se o link direto não tiver sido recebido, o item aparece como “Indisponível”; abrir a publicação diretamente ou recarregar a página normalmente resolve.
- **Carrosséis no feed:** os itens aparecem conforme o Instagram os carrega. Abrir a publicação garante a lista completa.
- **Links expiram:** os endereços do CDN são assinados e temporários. Recarregue a página antes de repetir downloads antigos.
- **Conteúdo privado:** a extensão só vê o que sua conta já pode ver; não contorna contas privadas, login ou outras proteções, e não deve ser usada para isso.
- **Botão sobre vídeos:** quando o vídeo é transmitido em partes e a publicação tem mais de um vídeo sem capa correspondente, o botão avisa que o vídeo está indisponível. Use o popup na página da publicação.
- **Stories e destaques** não são tratados de forma específica nesta versão.

## Privacidade

Veja [PRIVACY.md](PRIVACY.md). Resumo: nada sai do seu navegador.

## Próximos passos

- Seleção de mídias de várias publicações em sequência.
- Filtros por resolução e formato.
- Modelo de nome de arquivo configurável.
- Exportar relatório dos downloads.
- Testes de compatibilidade periódicos contra o Instagram.

## Licença

MIT
