# Meu Controle Financeiro — Angular

Reimplementação Angular 21 do aplicativo, usando a mesma instância e o mesmo schema Supabase da versão original.

## Estrutura

- `src/app/core`: modelos, acesso ao Supabase, estado compartilhado e feedback tátil.
- `src/app/pages`: início, lançamentos, dívidas, histórico, relatórios e cadastros.
- componentes standalone, rotas lazy-loaded, signals e PWA.

Antes de usar, execute as migrations `migration_v2.sql`, `migration_v3.sql`, `migration_v4.sql`, `migration_v5.sql` e `migration_v6.sql` da pasta `../supabase`.

## Desenvolvimento

```bash
npm install
npm start
```

## Teste e build para GitHub Pages

```bash
npm test -- --watch=false
npm run build -- --base-href /controle-financeiro/
```

As rotas usam hash (`/#/inicio`), evitando erro 404 no GitHub Pages. O resultado fica em `dist/angular-app/browser`.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.22.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
