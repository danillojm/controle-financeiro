import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FeedbackService } from './core/feedback.service';
import { FinanceStore } from './core/finance-store.service';
import { SupabaseService } from './core/supabase.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly sb = inject(SupabaseService).client;
  readonly store = inject(FinanceStore);
  readonly feedback = inject(FeedbackService);
  readonly authenticated = signal(false);
  readonly ready = signal(false);
  readonly authMessage = signal('');
  email = '';
  password = '';
  constructor() {
    this.sb.auth.onAuthStateChange(async (event, session) => {
      this.authenticated.set(Boolean(session));
      if (session) {
        try {
          await this.store.initialize(session.user.id);
          if (event === 'PASSWORD_RECOVERY') {
            const password = prompt('Informe sua nova senha (mínimo de 6 caracteres):');
            if (password && password.length >= 6) {
              const { error } = await this.sb.auth.updateUser({ password });
              if (error) throw error;
              this.feedback.show('Senha atualizada.');
            }
          }
        } catch (error: any) {
          this.feedback.show(error.message, 'error');
        }
      }
      this.ready.set(true);
    });
  }
  async login() {
    this.authMessage.set('Entrando...');
    const { error } = await this.sb.auth.signInWithPassword({
      email: this.email,
      password: this.password,
    });
    this.authMessage.set(error?.message || '');
  }
  async signup() {
    const { error } = await this.sb.auth.signUp({ email: this.email, password: this.password });
    this.authMessage.set(error?.message || 'Conta criada. Confira seu e-mail.');
  }
  async recover() {
    if (!this.email) return this.authMessage.set('Informe seu e-mail.');
    const { error } = await this.sb.auth.resetPasswordForEmail(this.email, {
      redirectTo: location.href,
    });
    this.authMessage.set(error?.message || 'Link de recuperação enviado.');
  }
  logout() {
    this.sb.auth.signOut();
  }
}
