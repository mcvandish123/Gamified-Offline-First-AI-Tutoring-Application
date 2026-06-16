import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class AuthService {
  constructor(private supabase: SupabaseService) {}

  async register(email: string, password: string, username: string) {
    const client = this.supabase.getClient();

    // Create user in Supabase Auth
    const { data: authData, error: authError } =
      await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError) throw new BadRequestException(authError.message);

    const userId = authData.user.id;

    // Create profile in public users table
    const { error: profileError } = await client.from('users').insert({
      id: userId,
      email,
      username,
    });

    if (profileError) throw new BadRequestException(profileError.message);

    // Create initial user_progress row
    const { error: progressError } = await client.from('user_progress').insert({
      user_id: userId,
    });

    if (progressError) throw new BadRequestException(progressError.message);

    return {
      success: true,
      message: 'User registered successfully',
      user: { id: userId, email, username },
    };
  }
  // User Login
  async login(email: string, password: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw new BadRequestException(error.message);

    return {
      success: true,
      message: 'Login successful',
      session: data.session,
      user: data.user,
    };
  }
  // User Logout
  async logout(accessToken: string) {
    const client = this.supabase.getClient();

    const { error } = await client.auth.admin.signOut(accessToken);

    if (error) throw new BadRequestException(error.message);

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }
}
