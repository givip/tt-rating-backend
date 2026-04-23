import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('queue')
  @ApiOperation({ summary: 'Get moderation queue (stub)' })
  async getQueue() {
    return { pending: [], message: 'Moderation queue — coming soon' };
  }

  @Post('import')
  @ApiOperation({ summary: 'Bulk import players from CSV rows' })
  async bulkImport(@Body() body: { rows: Record<string, string>[] }) {
    return this.admin.bulkImportPlayers(body.rows);
  }
}
