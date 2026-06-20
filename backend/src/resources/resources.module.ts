import { Module } from '@nestjs/common';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';
import { SupabaseService } from '../supabase.service';

@Module({
  controllers: [ResourcesController],
  providers: [ResourcesService, SupabaseService],
})
export class ResourcesModule {}
