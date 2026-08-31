import { Injectable, signal } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  readonly message = signal('');
  readonly type = signal<'success' | 'error'>('success');
  private timer?: number;
  show(message: string, type: 'success' | 'error' = 'success') {
    if (/record "new" has no field|from_account_id/i.test(message)) {
      message = 'O banco precisa da correção v5. Execute supabase/migration_v5.sql no SQL Editor.';
    }
    this.message.set(message);
    this.type.set(type);
    if ('vibrate' in navigator) navigator.vibrate(type === 'error' ? [30, 40, 30] : 18);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.message.set(''), 4200);
  }
}
