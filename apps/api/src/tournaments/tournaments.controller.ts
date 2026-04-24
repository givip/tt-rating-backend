import {
  BadRequestException,
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
import { z, ZodError } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ZodBody } from '../common/zod-swagger';
import { TournamentsService } from './tournaments.service';

const CreateTournamentDto = z
  .object({
    title: z.string().min(1),
    clubId: z.string().uuid().nullish(),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
    matchFormat: z.enum(['bo3', 'bo5', 'bo7']).optional(),
    minRating: z.number().int().nullish(),
    maxRating: z.number().int().nullish(),
  })
  .passthrough();

const AddParticipantDto = z.object({ playerId: z.string().uuid() }).strict();

const CreateMatchDto = z
  .object({
    round: z.number().int().min(1),
    player1Id: z.string().uuid(),
    player2Id: z.string().uuid(),
    winnerId: z.string().uuid().nullish(),
    setsPlayer1: z.number().int().min(0).nullish(),
    setsPlayer2: z.number().int().min(0).nullish(),
    scoreDetails: z.unknown().optional(),
    playedAt: z.coerce.date().nullish(),
  })
  .strict();

function parseCreateMatch(body: unknown) {
  try {
    return CreateMatchDto.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException('Invalid request body');
    }
    throw err;
  }
}

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
  @ZodBody(CreateTournamentDto)
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.tournaments.create(req.user, body as Record<string, unknown>);
  }

  @Post(':id/participants')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Add participant to tournament' })
  @ZodBody(AddParticipantDto)
  async addParticipant(
    @Req() req: AuthedRequest,
    @Param('id') tournamentId: string,
    @Body() body: { playerId: string },
  ) {
    return this.tournaments.addParticipant(tournamentId, body.playerId, req.user);
  }

  @Post(':id/matches')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Create a match in the tournament' })
  @ZodBody(CreateMatchDto)
  async createMatch(
    @Req() req: AuthedRequest,
    @Param('id') tournamentId: string,
    @Body() body: unknown,
  ) {
    const dto = parseCreateMatch(body);
    return this.tournaments.createMatch(tournamentId, dto, req.user);
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
