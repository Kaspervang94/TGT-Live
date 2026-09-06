import { supabase } from "./supabase";
import { getTournamentBySeason } from "./seasonAdmin";

function normalizeTeamName(name) {
  const value = name?.trim();

  if (!value) {
    throw new Error(
      "Holdnavnet skal udfyldes."
    );
  }

  return value;
}

function validatePlayerIds(playerIds) {
  const ids = (playerIds ?? []).filter(Boolean);
  const uniqueIds = [...new Set(ids)];

  if (uniqueIds.length !== 2) {
    throw new Error(
      "Et hold skal have præcis to forskellige spillere."
    );
  }

  return uniqueIds;
}

async function getEligibleSeasonPlayers(
  tournamentId
) {
  const { data, error } = await supabase
    .from("players")
    .select(`
      id,
      tournament_id,
      name,
      email,
      handicap_index,
      active,
      team_competition
    `)
    .eq("tournament_id", tournamentId)
    .eq("active", true)
    .eq("team_competition", true)
    .order("name", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function validatePlayersForTeam({
  tournamentId,
  playerIds,
  currentTeamId = null,
}) {
  const validatedPlayerIds =
    validatePlayerIds(playerIds);

  const { data: players, error: playerError } =
    await supabase
      .from("players")
      .select(`
        id,
        tournament_id,
        name,
        active,
        team_competition
      `)
      .eq("tournament_id", tournamentId)
      .in("id", validatedPlayerIds);

  if (playerError) {
    throw playerError;
  }

  if ((players ?? []).length !== 2) {
    throw new Error(
      "En eller flere af spillerne findes ikke i den valgte sæson."
    );
  }

  const invalidPlayer = players.find(
    (player) =>
      player.active !== true ||
      player.team_competition !== true
  );

  if (invalidPlayer) {
    throw new Error(
      `${invalidPlayer.name} er ikke aktiv i holdturneringen.`
    );
  }

  const { data: memberships, error: membershipError } =
    await supabase
      .from("team_members")
      .select(`
        team_id,
        player_id,
        teams (
          id,
          name,
          tournament_id,
          active
        )
      `)
      .in("player_id", validatedPlayerIds);

  if (membershipError) {
    throw membershipError;
  }

  const conflictingMembership = (
    memberships ?? []
  ).find((membership) => {
    const belongsToCurrentTeam =
      currentTeamId &&
      membership.team_id === currentTeamId;

    const belongsToThisTournament =
      membership.teams?.tournament_id ===
      tournamentId;

    return (
      belongsToThisTournament &&
      !belongsToCurrentTeam
    );
  });

  if (conflictingMembership) {
    const player = players.find(
      (item) =>
        item.id ===
        conflictingMembership.player_id
    );

    throw new Error(
      `${player?.name ?? "Spilleren"} er allerede tilknyttet holdet ${
        conflictingMembership.teams?.name ??
        "et andet hold"
      }.`
    );
  }

  return {
    playerIds: validatedPlayerIds,
    players,
  };
}

/**
 * Henter hold, holdmedlemmer og mulige
 * holdspillere for én sæson.
 */
export async function getSeasonTeams(
  season = 2027
) {
  const tournament =
    await getTournamentBySeason(season);

  if (!tournament) {
    throw new Error(
      `TGT ${season} blev ikke fundet.`
    );
  }

  const [
    teamsResult,
    membershipsResult,
    eligiblePlayers,
  ] = await Promise.all([
    supabase
      .from("teams")
      .select(`
        id,
        tournament_id,
        name,
        active,
        created_at
      `)
      .eq(
        "tournament_id",
        tournament.id
      )
      .order("name", {
        ascending: true,
      }),

    supabase
      .from("team_members")
      .select(`
        team_id,
        player_id,
        players (
          id,
          name,
          email,
          handicap_index,
          active,
          team_competition
        ),
        teams!inner (
          id,
          tournament_id
        )
      `)
      .eq(
        "teams.tournament_id",
        tournament.id
      ),

    getEligibleSeasonPlayers(
      tournament.id
    ),
  ]);

  if (teamsResult.error) {
    throw teamsResult.error;
  }

  if (membershipsResult.error) {
    throw membershipsResult.error;
  }

  const memberships =
    membershipsResult.data ?? [];

  const teams = (
    teamsResult.data ?? []
  ).map((team) => ({
    ...team,

    members: memberships
      .filter(
        (membership) =>
          membership.team_id === team.id
      )
      .map((membership) => ({
        playerId:
          membership.player_id,

        id:
          membership.players?.id,

        name:
          membership.players?.name,

        email:
          membership.players?.email,

        handicapIndex:
          membership.players
            ?.handicap_index,

        active:
          membership.players?.active,

        teamCompetition:
          membership.players
            ?.team_competition,
      })),
  }));

  return {
    tournament,
    teams,
    eligiblePlayers,
  };
}

/**
 * Opretter et nyt hold med præcis to spillere.
 */
export async function createSeasonTeam({
  season = 2027,
  name,
  playerIds,
}) {
  const tournament =
    await getTournamentBySeason(season);

  if (!tournament) {
    throw new Error(
      `TGT ${season} blev ikke fundet.`
    );
  }

  if (tournament.locked_at) {
    throw new Error(
      `TGT ${season} er låst.`
    );
  }

  const normalizedName =
    normalizeTeamName(name);

  const validated =
    await validatePlayersForTeam({
      tournamentId:
        tournament.id,
      playerIds,
    });

  const { data: existingTeam, error: existingError } =
    await supabase
      .from("teams")
      .select(`
        id,
        name,
        active
      `)
      .eq(
        "tournament_id",
        tournament.id
      )
      .ilike(
        "name",
        normalizedName
      )
      .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingTeam) {
    throw new Error(
      `Holdet ${normalizedName} findes allerede i TGT ${season}.`
    );
  }

  const { data: newTeam, error: teamError } =
    await supabase
      .from("teams")
      .insert({
        tournament_id:
          tournament.id,
        name: normalizedName,
        active: true,
      })
      .select(`
        id,
        tournament_id,
        name,
        active,
        created_at
      `)
      .single();

  if (teamError) {
    throw teamError;
  }

  const memberRows =
    validated.playerIds.map(
      (playerId) => ({
        team_id: newTeam.id,
        player_id: playerId,
      })
    );

  const { error: memberError } =
    await supabase
      .from("team_members")
      .insert(memberRows);

  if (memberError) {
    await supabase
      .from("teams")
      .delete()
      .eq("id", newTeam.id);

    throw memberError;
  }

  return {
    ...newTeam,
    members:
      validated.players,
  };
}

/**
 * Opdaterer holdnavn og holdets to spillere.
 */
export async function updateSeasonTeam({
  teamId,
  name,
  playerIds,
}) {
  if (!teamId) {
    throw new Error(
      "Hold-ID mangler."
    );
  }

  const normalizedName =
    normalizeTeamName(name);

  const { data: currentTeam, error: currentTeamError } =
    await supabase
      .from("teams")
      .select(`
        id,
        tournament_id,
        name,
        active,
        tournaments (
          id,
          season,
          locked_at
        )
      `)
      .eq("id", teamId)
      .single();

  if (currentTeamError) {
    throw currentTeamError;
  }

  if (
    currentTeam.tournaments?.locked_at
  ) {
    throw new Error(
      `TGT ${currentTeam.tournaments.season} er låst.`
    );
  }

  const validated =
    await validatePlayersForTeam({
      tournamentId:
        currentTeam.tournament_id,
      playerIds,
      currentTeamId: teamId,
    });

  const { data: duplicateTeam, error: duplicateError } =
    await supabase
      .from("teams")
      .select(`
        id,
        name
      `)
      .eq(
        "tournament_id",
        currentTeam.tournament_id
      )
      .ilike(
        "name",
        normalizedName
      )
      .neq("id", teamId)
      .maybeSingle();

  if (duplicateError) {
    throw duplicateError;
  }

  if (duplicateTeam) {
    throw new Error(
      `Et andet hold hedder allerede ${normalizedName}.`
    );
  }

  const { data: savedTeam, error: teamError } =
    await supabase
      .from("teams")
      .update({
        name: normalizedName,
      })
      .eq("id", teamId)
      .select(`
        id,
        tournament_id,
        name,
        active,
        created_at
      `)
      .single();

  if (teamError) {
    throw teamError;
  }

  const { error: deleteError } =
    await supabase
      .from("team_members")
      .delete()
      .eq("team_id", teamId);

  if (deleteError) {
    throw deleteError;
  }

  const newMemberships =
    validated.playerIds.map(
      (playerId) => ({
        team_id: teamId,
        player_id: playerId,
      })
    );

  const { error: insertError } =
    await supabase
      .from("team_members")
      .insert(newMemberships);

  if (insertError) {
    throw insertError;
  }

  return {
    ...savedTeam,
    members:
      validated.players,
  };
}

/**
 * Aktiverer eller deaktiverer et hold.
 *
 * Ved deaktivering bevares holdet og
 * medlemskaberne som historik.
 */
export async function setSeasonTeamActive({
  teamId,
  active,
}) {
  if (!teamId) {
    throw new Error(
      "Hold-ID mangler."
    );
  }

  const { data, error } = await supabase
    .from("teams")
    .update({
      active: Boolean(active),
    })
    .eq("id", teamId)
    .select(`
      id,
      tournament_id,
      name,
      active,
      created_at
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Frigør spillerne fra et hold og
 * deaktiverer derefter holdet.
 *
 * Brug denne funktion, hvis spillerne senere
 * skal kunne vælges til andre hold.
 */
export async function deactivateAndReleaseTeam(
  teamId
) {
  if (!teamId) {
    throw new Error(
      "Hold-ID mangler."
    );
  }

  const { error: membershipError } =
    await supabase
      .from("team_members")
      .delete()
      .eq("team_id", teamId);

  if (membershipError) {
    throw membershipError;
  }

  return setSeasonTeamActive({
    teamId,
    active: false,
  });
}

/**
 * Returnerer en status for holdopsætningen.
 */
export function summarizeSeasonTeams({
  teams,
  eligiblePlayers,
}) {
  const allTeams = teams ?? [];

  const activeTeams =
    allTeams.filter(
      (team) => team.active
    );

  const inactiveTeams =
    allTeams.filter(
      (team) => !team.active
    );

  const activeTeamPlayers =
    new Set(
      activeTeams.flatMap(
        (team) =>
          team.members.map(
            (member) => member.playerId
          )
      )
    );

  const availablePlayers = (
    eligiblePlayers ?? []
  ).filter(
    (player) =>
      !activeTeamPlayers.has(
        player.id
      )
  );

  const invalidActiveTeams =
    activeTeams.filter(
      (team) =>
        team.members.length !== 2
    );

  return {
    totalTeams:
      allTeams.length,

    activeTeams:
      activeTeams.length,

    inactiveTeams:
      inactiveTeams.length,

    assignedPlayers:
      activeTeamPlayers.size,

    availablePlayers:
      availablePlayers.length,

    invalidActiveTeams:
      invalidActiveTeams.length,
  };
}