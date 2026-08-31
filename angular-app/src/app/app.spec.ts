import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { SupabaseService } from './core/supabase.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: SupabaseService,
          useValue: {
            client: {
              auth: {
                onAuthStateChange: () => ({ data: {} }),
                signInWithPassword: async () => ({ error: null }),
                signUp: async () => ({ error: null }),
                resetPasswordForEmail: async () => ({ error: null }),
                signOut: async () => ({}),
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
