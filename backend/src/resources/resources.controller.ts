import {
  Controller,
  Get,
  Post,
  Param,
  Headers,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResourcesService } from './resources.service';
import { SupabaseService } from '../supabase.service';

@Controller('resources')
export class ResourcesController {
  constructor(
    private resourcesService: ResourcesService,
    private supabase: SupabaseService,
  ) {}

  private async getUserId(authorization: string): Promise<string> {
    const token = authorization?.replace('Bearer ', '');
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error) throw new Error('Unauthorized');
    return data.user.id;
  }

  @Get(':id')
  async getOne(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.resourcesService.getOne(userId, id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Headers('authorization') authorization: string,
    @UploadedFile() file: any,
  ) {
    const userId = await this.getUserId(authorization);
    return this.resourcesService.uploadResource(
      userId,
      file.buffer,
      file.originalname,
    );
  }

  @Post(':id/generate')
  async generate(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.resourcesService.generateModules(userId, id);
  }
}
