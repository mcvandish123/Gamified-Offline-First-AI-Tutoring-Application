import { Controller, Get, Patch, Body, Headers } from '@nestjs/common';
import { UsersService } from './users.service';
import { SupabaseService } from '../supabase.service';

class UpdateProfileDto {
  username?: string;
  avatarUrl?: string;
}

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private supabase: SupabaseService,
  ) {}

  private async getUserId(authorization: string): Promise<string> {
    const token = authorization?.replace('Bearer ', '');
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error) throw new Error('Unauthorized');
    return data.user.id;
  }

  @Get('me')
  async getProfile(@Headers('authorization') authorization: string) {
    const userId = await this.getUserId(authorization);
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  async updateProfile(
    @Headers('authorization') authorization: string,
    @Body() body: UpdateProfileDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.usersService.updateProfile(
      userId,
      body.username,
      body.avatarUrl,
    );
  }

  @Get('me/progress')
  async getProgress(@Headers('authorization') authorization: string) {
    const userId = await this.getUserId(authorization);
    return this.usersService.getProgress(userId);
  }
}
