import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inicio' },
  {
    path: 'inicio',
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage),
  },
  {
    path: 'lancamento',
    loadComponent: () => import('./pages/entry/entry').then((m) => m.EntryPage),
  },
  { path: 'dividas', loadComponent: () => import('./pages/debts/debts').then((m) => m.DebtsPage) },
  {
    path: 'historico',
    loadComponent: () => import('./pages/history/history').then((m) => m.HistoryPage),
  },
  {
    path: 'relatorios',
    loadComponent: () => import('./pages/reports/reports').then((m) => m.ReportsPage),
  },
  {
    path: 'cadastros',
    loadComponent: () => import('./pages/registers/registers').then((m) => m.RegistersPage),
  },
  { path: '**', redirectTo: 'inicio' },
];
