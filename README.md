# Meu Controle Financeiro — PWA

Aplicativo pessoal de finanças feito em HTML/CSS/JavaScript puro, preparado para **GitHub Pages + Supabase**. Não precisa de Node, npm, React ou processo de build.

## O que já funciona

- Login por e-mail e senha com Supabase Auth.
- Dashboard mensal: receitas, gastos próprios, valores a receber, valores a pagar e saldo entre pessoas.
- Cadastro rápido de despesas e receitas.
- Compras parceladas distribuídas automaticamente pelos meses das faturas.
- Responsabilidade do lançamento: meu gasto, outra pessoa me deve ou eu devo a outra pessoa.
- Tela de Dívidas com saldos individuais, valores a receber e valores a pagar.
- Marcar como pago ou reabrir uma dívida nos dois sentidos.
- Cadastro de pessoas e cartões.
- Receita recorrente mensal até dezembro.
- Histórico e exclusão de lançamentos.
- Exportação CSV.
- PWA: pode ser adicionada à Tela de Início no iPhone/iPad e instalada em navegadores compatíveis.
- Segurança com Row Level Security no Supabase: cada conta só enxerga os próprios dados.

## 1. Criar o Supabase

1. Crie uma conta gratuita em https://supabase.com e um projeto novo.
2. Abra **SQL Editor**.
3. Copie todo o conteúdo de `supabase/schema.sql` e execute.
4. Vá em **Project Settings > API**.
5. Copie a **Project URL** e a chave **anon / public**.
6. Abra `supabase-config.js` e substitua os dois valores de exemplo.

> A chave `anon` é própria para uso no navegador. A proteção dos dados é feita pelas políticas RLS do `schema.sql`. Nunca coloque a `service_role` no projeto publicado.

### Atualizar um projeto que já existe

Execute o arquivo `supabase/migration_v2.sql` no SQL Editor. A migração adiciona o campo de responsabilidade sem apagar lançamentos; despesas antigas vinculadas a outra pessoa são classificadas como **Outra pessoa me deve** e as demais como **Meu gasto**.

### Confirmação de e-mail

No Supabase, em Authentication, você pode manter confirmação por e-mail ativa. Para uma primeira configuração mais simples, também pode desativá-la temporariamente nas opções de autenticação.

## 2. Publicar gratuitamente no GitHub Pages

1. Crie um repositório no GitHub, por exemplo `controle-financeiro`.
2. Envie **todo o conteúdo desta pasta** para a raiz do repositório.
3. No GitHub, abra **Settings > Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Branch: `main`; pasta: `/ (root)`; clique em **Save**.
6. Aguarde a publicação. A URL será parecida com `https://SEU-USUARIO.github.io/controle-financeiro/`.

## 3. Configurar o endereço no Supabase

No Supabase, vá em **Authentication > URL Configuration**.

- Site URL: coloque a URL do GitHub Pages.
- Redirect URLs: adicione a mesma URL e, se quiser, a versão com `/**` no final.

Isso é importante principalmente se a confirmação por e-mail estiver ligada.

## 4. Instalar no iPhone/iPad

1. Abra a URL do GitHub Pages no Safari.
2. Toque em **Compartilhar**.
3. Escolha **Adicionar à Tela de Início**.
4. O ícone “Meu Controle” aparecerá junto dos aplicativos.

No Mac, Chrome/Edge podem oferecer a opção de instalar o app. No Safari, o site continua funcionando normalmente.

## Estrutura

- `index.html` — interface.
- `styles.css` — visual responsivo.
- `app.js` — lógica do aplicativo.
- `supabase-config.js` — URL e chave pública do Supabase.
- `manifest.webmanifest` — configuração PWA.
- `sw.js` — service worker/cache básico.
- `icons/` — ícones do aplicativo.
- `supabase/schema.sql` — banco, RLS e índices.
- `.nojekyll` — evita processamento desnecessário pelo GitHub Pages.

## Próximas melhorias possíveis

A estrutura já permite evoluir para importação da planilha antiga, fechamento automático pelo dia de fechamento de cada cartão, gráficos, notificações de cobrança, receitas recorrentes sem limite de dezembro e edição de lançamentos.
