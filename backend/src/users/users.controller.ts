import {
  Controller,
  Get,
  Patch,
  Body,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { SupabaseService } from '../supabase.service';
import { extractUserPayload } from '../extract-user-id';

class UpdateProfileDto {
  username?: string;
  fullName?: string;
  avatarUrl?: string;
}

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private supabase: SupabaseService,
  ) {}

  private async getUserId(authorization: string): Promise<string> {
    const payload = extractUserPayload(authorization);
    const userId = payload.sub;
    const email = payload.email || '';
    const username = payload.user_metadata?.username || '';
    await this.supabase.ensureUserExists(userId, email, username);
    return userId;
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
    // Support both "username" and "fullName" field names from the frontend
    const name = body.username ?? body.fullName;
    return this.usersService.updateProfile(userId, name, body.avatarUrl);
  }

  @Get('me/progress')
  async getProgress(@Headers('authorization') authorization: string) {
    const userId = await this.getUserId(authorization);
    return this.usersService.getProgress(userId);
  }
}
