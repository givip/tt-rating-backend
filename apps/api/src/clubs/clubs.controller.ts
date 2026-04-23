import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClubsService } from './clubs.service';

@ApiTags('clubs')
@Controller('clubs')
export class ClubsController {
  constructor(private clubs: ClubsService) {}

  @Get()
  @ApiOperation({ summary: 'List all clubs' })
  async findAll() {
    return this.clubs.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get club details' })
  async findOne(@Param('id') id: string) {
    return this.clubs.findOne(id);
  }
}
