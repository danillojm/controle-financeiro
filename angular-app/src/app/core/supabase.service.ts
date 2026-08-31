import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(
    'https://pbzogokbkkdjwhhiacqj.supabase.co',
    'sb_publishable_Z7dX6FSMWDqRE5f7WiMQ4w_bFlTIYwS',
  );
}
