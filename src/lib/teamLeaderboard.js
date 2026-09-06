import { supabase } from "./supabase";
import { calculateBestBallLeaderboard } from "./netScoreEngine";

/**
 * Henter og beregner holdleaderboardet til TGT-holdfinalen.
 *
 * Regler:
 * - Runde 6
 * - 100 % spillehandicap
 * - Best Ball hul for hul
 * - Laveste nettoscore på hvert hul tæller
 * - Begge holdspillere skal have registreret en score,
 *   før holdets hul tæller som afsluttet
 * - Spillere med team_competition = false medtages ikke
 */
export async function getTeamLea*erboard({
  season*= 2026,
  roundNumber = 6,
} = {}) {
  /*
   * 1. Find den ønskede runde.
   */
  const {
    data: round,
    *rror: roundError,
  } = await supa*ase
    .from("rounds")
    .selec*(`
      id,
      tournament_id,
*     course_id,
      round_number*
      name,
      played_at,
    * status,
      team_enabled,
     *tournaments!*nner (
        id,
        season
*     )
    `)
    .eq("tournaments*season", season)
    .eq("round_nu*ber", roundNumber)
    .single();
*  if (roundError) {
    throw roun*Error;
  }

  if (!round) {
    th*ow new Error(
      `Runde ${round*umber} blev ikke fundet.`
    );
 *}

  if (!round.team_enabled) {
  * throw new Error(
      `Holdturne*ingen er ikke aktiveret i Runde ${*oundNumber}.`
    );
  }

  if (!r*und.course_id) {
    throw new Err*r(
      `Runde ${roundNumber} har ingen golfbane tilknyttet.`
    );
  }

  /*
   * 2. Hent banens huller med par og stroke index.
   */
  const {
    data: holes,
    e*ror: holesError,
  } = await supab*se
    .from("course_holes")
    .*elect(`
      hole_number,
      p*r,
      stroke_index
    `)
    .*q("course_id", round.course_id)
  * .order("hole_number", {
      asc*nding: true,
    });

  if (holesE*ror) {
    throw holesError;
  }

  if (!holes || holes.length === 0) {
    throw new Error(
      "Banens scorekort kunne ikke findes."
    );
  }

  /*
   * 3. Hent alle aktive hold i TGT 2026.
   */
  const {
    data: te*mRows,
    error: teamsError,
  } * await supabase
    .from("teams")*    .select(`
      id,
      name*
      active
    `)
    .eq("tour*ament_id", round.tournament_id)
  * .eq("active", true)
    .order("n*me", {
      ascending: true,
    *);

  if (teamsError) {
    throw *eamsError;
  }

  const teamIds = (teamRows ?? []).map(
    (team) => team.id
  );

  if (teamIds.length === 0) {
    return {
      round,
      holes,
      teams: [],
      leaderboard: [],
    };
  }

  /*
   * 4. Hent medlemmerne af de aktive hold.
   *
   * team_competition bruges til at udelukke spillere,
   * som kun deltager individuelt.
   */
  const {
    data: membershipRows,
    error: membershipsError,
  } = await supabase
    .from("team_members")
    .select(`
      team_id,
      player_id,
      players (
        id,
        name,
        handicap_index,
        active,
        team_competition
      )
    `)
    .in("team_id", teamIds);

  if (membershipsError) {
    throw membershipsError;
  }

  const eligibleMemberships = (
    membershipRows ?? []
  ).filter(
    (membership) =>
      membership.players?.active === true &&
      membership.players?.team_competition !== false
  );

  const playerIds = [
    ...new Set(
      eligibleMemberships.map(
        (membership) => membership.player_id
      )
    ),
  ];

  /*
   * 5. Hent spillernes registrering på Runde 6.
   *
   * playing_handicap er rundens fastlåste spillehandicap.
   * Det er denne værdi, nettoscore-motoren bruger.
   */
  let roundPlayerRows = [];

  if (playerIds.length > 0) {
    const {
      data,
      error,
    } = await supabase
      .from("round_players")
      .select(`
        player_id,
        handicap_index,
        playing_handicap,
        status,
        tee_id
      `)
      .eq("round_id", round.id)
      .in("player_id", playerIds);

    if (error) {
      throw error;
    }

    roundPlayerRows = data ?? [];
  }

  const roundPlayerByPlayerId = new Map(
    roundPlayerRows.map((roundPlayer) => [
      roundPlayer.player_id,
      roundPlayer,
    ])
  );

  /*
   * 6. Hent alle live-scores for holdspillerne.
   */
  let scoreRows = [];

  if (playerIds.length > 0) {
    const {
      data,
      error,
    } = await supabase
      .from("scores")
      .select(`
        player_id,
        hole_number,
        strokes,
        updated_at
      `)
      .eq("round_id", round.id)
      .in("player_id", playerIds);

    if (error) {
      throw error;
    }

    scoreRows = data ?? [];
  }

  /*
   * 7. Byg holdene i det format, som
   * nettoscore-motoren forventer.
   */
  const teams = (teamRows ?? []).map(
    (team) => {
      const memberships =
        eligibleMemberships.filter(
          (membership) =>
            membership.team_id === team.id
        );

      const players = memberships.map(
        (membership) => {
          const player =
            membership.players;

          const roundPlayer =
            roundPlayerByPlayerId.get(
              membership.player_id
            );

          return {
            playerId: player.id,
            playerName: player.name,

            /*
             * Feltet findes på spilleren og beskytter
             * mod, at en individuel spiller ved en fejl
             * indgår i holdberegningen.
             */
            teamCompetition:
              player.team_competition,

            handicapIndex:
              roundPlayer?.handicap_index ??
              player.handicap_index ??
              null,

            /*
             * Der anvendes 100 % spillehandicap.
             * Vi ganger derfor ikke værdien med 0,85.
             */
            playingHandicap:
              roundPlayer?.playing_handicap ??
              0,

            roundStatus:
              roundPlayer?.status ??
              "Ikke tilmeldt",
          };
        }
      );

      return {
        teamId: team.id,
        teamName: team.name,
        players,
      };
    }
  );

  /*
   * 8. Beregn Best Ball-leaderboardet.
   */
  const leaderboard =
    calculateBestBallLeaderboard({
      teams,
      holes,
      scores: scoreRows,
    });

  return {
    round,
    holes,
    teams,
    scores: scoreRows,
    leaderboard,
  };
}

/**
 * Opretter en Supabase Realtime-kanal til holdfinalen.
 *
 * callback køres, hver gang en score ændres.
 */
export function subscribeToTeamLeaderboard({
  roundId,
  callback,
}) {
  if (!roundId) {
    throw new Error(
      "roundId mangler ved oprettelse af Realtime."
    );
  }

  const channel = supabase
    .channel(
      `tgt-team-leaderboard-${roundId}`
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "scores",
        filter: `round_id=eq.${roundId}`,
      },
      () => {
        callback?.();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };