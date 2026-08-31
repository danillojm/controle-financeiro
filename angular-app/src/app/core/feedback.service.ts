import { Injectable, signal } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  readonly message = signal('');
  readonly type = signal<'success' | 'error'>('success');
  private timer?: number;
  show(message: string, type: 'success' | 'error' = 'success') {
    this.message.set(message);
    this.type.set(type);
    if ('vibrate' in navigator) navigator.vibrate(type === 'error' ? [30, 40, 30] : 18);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.message.set(''), 4200);
  }
}
