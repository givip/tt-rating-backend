import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TournamentsService } from './tournaments.service';

type AuthedRequest = FastifyRequest & { user: { userId: string; role: string } };

@ApiTags('tournaments')
@Controller('tournaments')
export class TournamentsController {
  constructor(private tournaments: TournamentsService) {}

  @Get()
  @ApiOperation({ summary: 'List tournaments' })
  async findAll(@Query('organizerId') organizerId?: string) {
    return this.tournaments.findAll(organizerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tournament details with participants and matches' })
  async findOne(@Param('id') id: string) {
    return this.tournaments.findOne(id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Create tournament (organizer)' })
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.tournaments.create(req.user, body as Record<string, unknown>);
  }

  @Post(':id/participants')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Add participant to tournament' })
  async addParticipant(
    @Req() req: AuthedRequest,
    @Param('id') tournamentId: string,
    @Body() body: { playerId: string },
  ) {
    return this.tournaments.addParticipant(tournamentId, body.playerId, req.user);
  }

  @Patch(':id/finalize')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Finalize tournament and trigger rating calculation' })
  async finalize(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.tournaments.finalize(id, req.user);
  }
}
