import "./App.css";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import {
  getRoundScores,
  saveHoleScores,
} from "./lib/scores";
import { getLiveRoundLeaderboard } from "./lib/liveLeaderboard";
import { getTeamLeaderboard } from "./lib/teamLeaderboard";
import {
  applyIndividualBonuses,
  sortIndividualLeaderboard,
} from "./lib/individualBonus";
import {
  calculateClosestToPinLeaders,
  deleteClosestToPinEntry,
  getClosestToPinEntries,
  getFlightClosestEntry,
  saveClosestToPinEntry,
} from "./lib/closestToPin";
import {
  getFinalFlightsPreview,
  validateFinalFlightsPreview,
} from "./lib/finalFlights";
import { getFinalStandings } from "./lib/finalStandings";
import { getFormattedHallOfFame } from "./lib/hallOfFame";
import {
  createSeasonPlayer,
  getSeasonPlayers,
  summarizeSeasonPlayers,
  updateSeasonPlayer,
} from "./lib/seasonAdmin";
import {
  createSeasonTeam,
  deactivateAndReleaseTeam,
  getSeasonTeams,
  summarizeSeasonTeams,
  updateSeasonTeam,
} from "./lib/teamAdmin";
import {
  createSeasonRound,
  getCourseTees,
  getSeasonRounds,
  summarizeSeasonRounds,
  updateRoundStatus,
  updateSeasonRound,
} from "./lib/roundAdmin";
import {
  getRoundParticipants,
  saveRoundParticipants,
  summarizeRoundParticipants,
} from "./lib/roundParticipants";
import {
  createFlight,
  deleteEmptyFlight,
  getFlightAdminData,
  getSeasonRoundsForFlights,
  saveFlightPlayers,
  summarizeFlightSetup,
  updateFlight,
} from "./lib/flightAdmin";

const ACTIVE_SEASON = 2027;

const LUBKER_FINAL_COURSES = [
  { clubName: "Lübker Golf Klub", courseName: "Sand/Forest",
    holes: [[1,5,3],[2,3,17],[3,4,11],[4,3,13],[5,5,1],[6,3,15],[7,4,7],[8,5,5],[9,4,9],[10,5,2],[11,4,6],[12,5,4],[13,4,8],[14,3,18],[15,4,12],[16,3,16],[17,4,14],[18,4,10]],
    tees: [["Gold · Herre",75.1,138,6215],["Sort · Herre",73.5,134,5882],["White · Herre",71.8,131,5537],["Yellow · Herre",69.6,127,5102],["Red · Herre",66.9,125,4640],["Gold · Dame",81.6,150,6215],["Sort · Dame",79.7,145,5882],["White · Dame",77.6,141,5537],["Yellow · Dame",74.9,136,5102],["Red · Dame",72.1,130,4640]] },
  { clubName: "Lübker Golf Klub", courseName: "Sand/Sky",
    holes: [[1,5,3],[2,3,17],[3,4,11],[4,3,13],[5,5,1],[6,3,15],[7,4,7],[8,5,5],[9,4,9],[10,5,4],[11,4,6],[12,4,12],[13,3,18],[14,4,14],[15,4,10],[16,3,16],[17,4,8],[18,5,2]],
    tees: [["Gold · Herre",76.3,147,6476],["Sort · Herre",74.5,142,6103],["White · Herre",72.8,139,5770],["Yellow · Herre",71.1,136,5415],["Red · Herre",68.0,132,4841],["Gold · Dame",83.5,154,6476],["Sort · Dame",81.3,149,6103],["White · Dame",79.3,145,5770],["Yellow · Dame",77.1,140,5415],["Red · Dame",73.6,133,4841]] },
];

function usePositionChanges(entries = [], getId = (entry) => entry?.id, scoreEventVersion = 0) {
  const previousPositionsRef = useRef(new Map());
  const processedEventVersionRef = useRef(scoreEventVersion);
  const [changes, setChanges] = useState({});
  const signature = entries.map((entry) => String(getId(entry) ?? "")).join("|");
  useEffect(() => {
    const next = new Map();
    entries.forEach((entry, index) => {
      const id = String(getId(entry) ?? "");
      if (id) next.set(id, index + 1);
    });
    const previous = previousPositionsRef.current;
    const isNewRealScoreEvent = scoreEventVersion > processedEventVersionRef.current;
    if (previous.size === 0 || !isNewRealScoreEvent) {
      previousPositionsRef.current = next;
      processedEventVersionRef.current = scoreEventVersion;
      setChanges({});
      return;
    }
    const nextChanges = {};
    next.forEach((position, id) => {
      const previousPosition = previous.get(id);
      nextChanges[id] = previousPosition ? previousPosition - position : 0;
    });
    previousPositionsRef.current = next;
    processedEventVersionRef.current = scoreEventVersion;
    setChanges(nextChanges);
  }, [signature, scoreEventVersion]);
  return changes;
}
function PositionMovement({ value = 0 }) {
  const movement = Number(value) || 0;
  if (movement > 0) return <span className="tgt-position-movement up" title={`Steget ${movement} placering${movement === 1 ? "" : "er"}`}>▲{movement}</span>;
  if (movement < 0) return <span className="tgt-position-movement down" title={`Faldet ${Math.abs(movement)} placering${Math.abs(movement) === 1 ? "" : "er"}`}>▼{Math.abs(movement)}</span>;
  return null;
}
function formatScore(score) {
  if (score === null || score === undefined) {
    return "Afventer";
  }

  if (score === 0) {
    return "E";
  }

  return score > 0 ? `+${score}` : String(score);
}

function getLeaderboardScoreStyle(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return {};
  if (value < 0) return { color: "#b43b32", fontWeight: 900 };
  if (value === 0) return { color: "#18864b", fontWeight: 900 };
  return { color: "inherit", fontWeight: 900 };
}
function hasActualScore(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}
function normalizeTeamScorecard(scorecard = []) {
  return scorecard.map((hole) => {
    const par = Number(hole?.par);
    const rawNetStrokes = hole?.netStrokes ?? hole?.net_strokes;
    const netStrokes = hasActualScore(rawNetStrokes) ? Number(rawNetStrokes) : null;
    const hasNetResult = Number.isFinite(par) && hasActualScore(netStrokes);
    return {
      ...hole,
      netStrokes: Number.isFinite(netStrokes) ? netStrokes : hole?.netStrokes,
      toPar: hasNetResult ? netStrokes - par : hole?.toPar,
    };
  });
}
function getLivePlayerId(player = {}) {
  return player?.playerId ?? player?.player_id ?? player?.id ?? player?.players?.id ?? null;
}
function getLivePlayerName(player = {}) {
  return player?.playerName ?? player?.player_name ?? player?.name ?? player?.players?.name ?? "";
}
function getTeamPlayerReferences(team = {}) {
  const nested = [
    ...(team.members ?? []), ...(team.players ?? []),
    ...(team.teamMembers ?? team.team_members ?? []),
    team.playerOne, team.player_one, team.player1, team.player_1,
    team.playerTwo, team.player_two, team.player2, team.player_2,
  ].filter(Boolean);
  const directIds = [
    team.playerOneId, team.player_one_id, team.player1Id, team.player_1_id,
    team.playerTwoId, team.player_two_id, team.player2Id, team.player_2_id,
    ...(team.playerIds ?? team.player_ids ?? team.memberIds ?? team.member_ids ?? []),
  ].filter(Boolean);
  const directNames = [
    team.playerOneName, team.player_one_name, team.player1Name, team.player_1_name,
    team.playerTwoName, team.player_two_name, team.player2Name, team.player_2_name,
  ].filter(Boolean);
  return {
    ids: [...new Set([...directIds, ...nested.map(getLivePlayerId)].filter(Boolean).map(String))],
    names: [...new Set([...directNames, ...nested.map(getLivePlayerName)].filter(Boolean).map((name) => String(name).trim().toLocaleLowerCase("da")))],
  };
}

// Beregn holdets best ball direkte fra de allerede netto-normaliserede
// individuelle scorekort. Dermed kan en brutto-score fra team-viewet ikke
// overstyre handicapslagene.
function normalizeTeamLiveLeaderboard(
  teamLeaderboard = [],
  individualLeaderboard = []
) {
  const individualById = new Map(
    individualLeaderboard.map((player) => [String(getLivePlayerId(player) ?? ""), player]).filter(([id]) => id)
  );
  const individualByName = new Map(
    individualLeaderboard.map((player) => [getLivePlayerName(player).trim().toLocaleLowerCase("da"), player]).filter(([name]) => name)
  );
  return teamLeaderboard
    .map((team) => {
      const references = getTeamPlayerReferences(team);
      const teamPlayers = [...new Set([
        ...references.ids.map((id) => individualById.get(id)),
        ...references.names.map((name) => individualByName.get(name)),
      ].filter(Boolean))];
      // Hvis team-helperen ikke sender medlems-id'er, beholdes dens scorekort.
      // Når id'erne findes, er de individuelle netto-scorekort sandhedskilden.
      if (teamPlayers.length < 2) {
        const scorecard = normalizeTeamScorecard(team?.scorecard ?? []);
        return {
          ...team,
          scorecard,
          holesPlayed: scorecard.filter((hole) =>
            hasActualScore(hole?.netStrokes)
          ).length,
          scoreToPar: getTeamScoreToPar({ ...team, scorecard }),
        };
      }

      const holesByPlayer = teamPlayers.map((player) =>
        new Map(
          (player.scorecard ?? []).map((hole, index) => [
            Number(hole?.holeNumber ?? hole?.hole_number ?? index + 1),
            hole,
          ])
        )
      );
      const holeNumbers = [...new Set(
        holesByPlayer.flatMap((holes) => [...holes.keys()])
      )].sort((a, b) => a - b);

      const scorecard = holeNumbers.map((holeNumber) => {
        const playerHoles = holesByPlayer.map((holes) => holes.get(holeNumber));
        const allPlayersScored = playerHoles.every((hole) =>
          hole &&
          hasActualScore(hole.strokes) &&
          hasActualScore(hole.netStrokes) &&
          hasActualScore(hole.toPar)
        );
        const template = playerHoles.find(Boolean) ?? {};
        const par = Number(template.par);
        if (!allPlayersScored || !Number.isFinite(par)) {
          return {
            ...template,
            holeNumber,
            netStrokes: null,
            toPar: null,
          };
        }
        // Brug spillernes allerede beregnede nettoresultat mod par som
        // sandhedskilde. Et nettoresultat på -1 skal gøre holdets samlede
        // score ét slag lavere, fx -5 + (-1) = -6.
        const bestToPar = Math.min(
          ...playerHoles.map((hole) => Number(hole.toPar))
        );
        const bestNetStrokes = par + bestToPar;
        return {
          ...template,
          holeNumber,
          strokes: bestNetStrokes,
          netStrokes: bestNetStrokes,
          toPar: bestToPar,
        };
      });
      const playedHoles = scorecard.filter((hole) =>
        hasActualScore(hole.netStrokes) && hasActualScore(hole.par)
      );
      const scoreToPar = playedHoles.reduce(
        (total, hole) => total + Number(hole.toPar),
        0
      );

      return {
        ...team,
        scorecard,
        holesPlayed: playedHoles.length,
        thru: playedHoles.length,
        netStrokes: playedHoles.reduce(
          (total, hole) => total + Number(hole.netStrokes),
          0
        ),
        scoreToPar,
        score_to_par: scoreToPar,
        bestBallScore: scoreToPar,
      };
    })
    .sort((a, b) => {
      const scoreDifference =
        Number(getTeamScoreToPar(a) ?? Infinity) -
        Number(getTeamScoreToPar(b) ?? Infinity);
      return scoreDifference ||
        String(a.teamName ?? a.name ?? "").localeCompare(
          String(b.teamName ?? b.name ?? ""),
          "da"
        );
    });
}

function getTeamScoreToPar(team) {
  const scorecard = normalizeTeamScorecard(team?.scorecard ?? []);
  const playedHoles = scorecard.filter(
    (hole) => hasActualScore(hole?.netStrokes) && hasActualScore(hole?.par)
  );
  if (playedHoles.length > 0) {
    return playedHoles.reduce(
      (total, hole) => total + (Number(hole.netStrokes) - Number(hole.par)),
      0
    );
  }
  const candidates = [team?.scoreToPar, team?.score_to_par, team?.score, team?.bestBallScore];
  const value = candidates.find((candidate) => candidate !== null && candidate !== undefined && Number.isFinite(Number(candidate)));
  return value === undefined ? null : Number(value);
}
function getInitials(name = "") {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("") || "TGT";
}

function getScoreMarkStyle(toPar) {
  const base = { display: "inline-grid", placeItems: "center", minWidth: 30, height: 30, padding: "0 5px", fontWeight: 900, lineHeight: 1 };
  if (toPar <= -2) return { ...base, border: "3px double #18864b", borderRadius: "50%", color: "#126738", background: "#e9f8ef" };
  if (toPar === -1) return { ...base, border: "2px solid #28a45f", borderRadius: "50%", color: "#126738", background: "#effaf3" };
  if (toPar === 1) return { ...base, border: "2px solid #168454", borderRadius: 3, color: "#0b6543", background: "#eff7f2" };
  if (toPar >= 2) return { ...base, border: "3px double #b43b32", borderRadius: 3, color: "#8c241e", background: "#fff0ee" };
  return { ...base, color: "#24372f" };
}

function calculatePlayingHandicap(handicapIndex, slopeRating, courseRating, coursePar) {
  const values = [handicapIndex, slopeRating, courseRating, coursePar].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [hcp, slope, rating, par] = values;
  return Math.round(hcp * (slope / 113) + (rating - par));
}

function getAllocatedStrokes(playingHandicap, strokeIndex) {
  const handicap = Number(playingHandicap);
  const index = Number(strokeIndex);
  if (!Number.isFinite(handicap) || !Number.isFinite(index) || handicap <= 0) return 0;
  return Math.floor((handicap - 1) / 18) + (index <= ((handicap - 1) % 18) + 1 ? 1 : 0);
}
function getPlayerPlayingHandicap(player, roundData = null) {
  const directCandidates = [
    player?.playingHandicap,
    player?.playing_handicap,
    player?.courseHandicap,
    player?.course_handicap,
    player?.sph,
  ];
  const directValue = directCandidates.find(
    (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) !== 0
  );
  if (directValue !== undefined) return Number(directValue);

  const handicapIndex = player?.handicapIndex ?? player?.handicap ?? player?.handicap_index;
  const slopeRating = player?.slopeRating ?? player?.slope_rating ?? roundData?.tee?.slope_rating ?? roundData?.courseTee?.slope_rating ?? roundData?.course_tee?.slope_rating ?? roundData?.slopeRating ?? roundData?.slope_rating;
  const courseRating = player?.courseRating ?? player?.course_rating ?? roundData?.tee?.course_rating ?? roundData?.courseTee?.course_rating ?? roundData?.course_tee?.course_rating ?? roundData?.courseRating ?? roundData?.course_rating;
  const scorecardPar = (player?.scorecard ?? []).reduce(
    (total, hole) => total + (Number(hole?.par) || 0),
    0
  );
  const roundPar = (roundData?.holes ?? roundData?.courseHoles ?? []).reduce(
    (total, hole) => total + (Number(hole?.par) || 0),
    0
  );
  const coursePar = scorecardPar > 0 ? scorecardPar : roundPar;
  const calculated = calculatePlayingHandicap(handicapIndex, slopeRating, courseRating, coursePar);
  if (calculated !== null) return calculated;

  const allocatedStrokes = (player?.scorecard ?? []).reduce(
    (total, hole) => total + (Number(hole?.strokesReceived) || 0),
    0
  );
  return allocatedStrokes > 0 ? allocatedStrokes : null;
}

// Retter livescoren til NETTO i forhold til par.
// Handicapslag fordeles efter spillerens SPH og hullets stroke index.
function normalizeIndividualLiveLeaderboard(leaderboard = [], roundData = null) {
  const roundHoles = roundData?.holes ?? roundData?.courseHoles ?? [];
  const roundHoleByNumber = new Map(
    roundHoles.map((hole, index) => [
      Number(hole?.holeNumber ?? hole?.hole_number ?? index + 1),
      hole,
    ])
  );

  return leaderboard.map((player) => {
    const playingHandicap = getPlayerPlayingHandicap(player, roundData);
    const rawScorecard = player?.scorecard ?? [];

    const scorecard = rawScorecard.map((hole, index) => {
      const holeNumber = Number(
        hole?.holeNumber ?? hole?.hole_number ?? roundHoles[index]?.hole_number ?? index + 1
      );
      const courseHole = roundHoleByNumber.get(holeNumber) ?? roundHoles[index] ?? {};

      const strokesValue =
        hole?.strokes ??
        hole?.grossStrokes ??
        hole?.gross_strokes ??
        hole?.score ??
        hole?.grossScore ??
        hole?.gross_score;
      const strokes =
        strokesValue === null || strokesValue === undefined || strokesValue === ""
          ? null
          : Number(strokesValue);

      const par = Number(hole?.par ?? courseHole?.par);
      const strokeIndex = Number(
        hole?.strokeIndex ??
        hole?.stroke_index ??
        courseHole?.strokeIndex ??
        courseHole?.stroke_index
      );

      const savedReceivedValue =
        hole?.strokesReceived ??
        hole?.strokes_received ??
        hole?.receivedStrokes ??
        hole?.received_strokes ??
        hole?.handicapStrokes ??
        hole?.handicap_strokes;
      const savedReceived = Number(savedReceivedValue);
      // Backendens live-scorekort kan sende strokesReceived: 0 som standard.
      // Det må ikke overstyre den korrekte handicapfordeling. Når SPH og
      // stroke index findes, beregner vi derfor altid slagene lokalt.
      const calculatedReceived = getAllocatedStrokes(
        playingHandicap,
        strokeIndex
      );
      const canCalculateReceived =
        Number.isFinite(Number(playingHandicap)) &&
        Number.isFinite(strokeIndex);
      const strokesReceived = canCalculateReceived
        ? calculatedReceived
        : savedReceivedValue !== null &&
            savedReceivedValue !== undefined &&
            savedReceivedValue !== "" &&
            Number.isFinite(savedReceived)
          ? savedReceived
          : 0;

      const netStrokes =
        Number.isFinite(strokes) && Number.isFinite(strokesReceived)
          ? strokes - strokesReceived
          : null;
      const toPar =
        netStrokes !== null && Number.isFinite(par)
          ? netStrokes - par
          : null;

      return {
        ...courseHole,
        ...hole,
        holeNumber,
        par: Number.isFinite(par) ? par : null,
        strokeIndex: Number.isFinite(strokeIndex) ? strokeIndex : null,
        strokes: Number.isFinite(strokes) ? strokes : null,
        strokesReceived,
        netStrokes,
        toPar,
      };
    });

    const playedHoles = scorecard.filter((hole) => Number.isFinite(hole.strokes));
    const grossStrokes = playedHoles.reduce(
      (total, hole) => total + hole.strokes,
      0
    );
    const netStrokes = playedHoles.reduce(
      (total, hole) => total + Number(hole.netStrokes),
      0
    );
    const scoreToPar = playedHoles.reduce(
      (total, hole) => total + Number(hole.toPar),
      0
    );

    return {
      ...player,
      playingHandicap,
      scorecard,
      holesPlayed: playedHoles.length,
      grossStrokes,
      netStrokes,
      scoreToPar,
    };
  });
}
function formatDate(date) {
  if (!date) {
    return "Ikke angivet";
  }

  return new Intl.DateTimeFormat("da-DK", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatTime(time) {
  if (!time) {
    return "Ikke angivet";
  }

  return time.slice(0, 5);
}

function getManualFinalBase(roundScores = []) {
  const scores = roundScores.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (scores.length < 3) return { eligible:false, countingScore:null, halvedScore:null, usedScores:[] };
  const usedScores = scores.slice(0,4);
  if (usedScores.length === 3) usedScores.push(Math.max(...usedScores));
  const countingScore = usedScores.reduce((sum,score)=>sum+score,0);
  return { eligible:true, countingScore, halvedScore:Math.trunc(countingScore/2), usedScores };
}
function sortStandings(data) {
  return [...(data ?? [])].sort((a, b) => {
    const aQualified = a.counting_rounds === 4;
    const bQualified = b.counting_rounds === 4;

    if (aQualified !== bQualified) {
      return aQualified ? -1 : 1;
    }

    if (aQualified && bQualified) {
      if (a.halved_score !== b.halved_score) {
        return (
          (a.halved_score ?? Infinity) -
          (b.halved_score ?? Infinity)
        );
      }
    }

    if (a.counting_score !== b.counting_score) {
      return (
        (a.counting_score ?? Infinity) -
        (b.counting_score ?? Infinity)
      );
    }

    if (a.rounds_played !== b.rounds_played) {
      return b.rounds_played - a.rounds_played;
    }

    return a.player_name.localeCompare(
      b.player_name,
      "da"
    );
  });
}


function SplitScorecard({ scorecard = [], handicapIndex = null, playingHandicap = null, position = null }) {
  const normalized = Array.from({ length: 18 }, (_, index) => {
    const holeNumber = index + 1;
    return scorecard.find((hole) => Number(hole.holeNumber) === holeNumber) ?? {
      holeNumber,
      par: null,
      strokeIndex: null,
      strokesReceived: 0,
      strokes: null,
      netStrokes: null,
      toPar: null,
    };
  });

  const played = normalized.filter((hole) => hole.strokes !== null && hole.strokes !== undefined);
  const totalPar = normalized.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
  const grossTotal = played.reduce((sum, hole) => sum + Number(hole.strokes), 0);
  const netTotal = played.reduce((sum, hole) => sum + Number(hole.netStrokes ?? hole.strokes), 0);
  const totalToPar = played.reduce((sum, hole) => sum + (Number(hole.toPar) || 0), 0);

  const renderMobileNine = (holes, totalLabel) => {
    const ninePlayed = holes.filter((hole) => hole.strokes !== null && hole.strokes !== undefined);
    const ninePar = holes.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
    const nineGross = ninePlayed.reduce((sum, hole) => sum + Number(hole.strokes), 0);
    const nineNet = ninePlayed.reduce((sum, hole) => sum + Number(hole.netStrokes ?? hole.strokes), 0);

    return (
      <div className="tgt-gb-nine">
        <div className="tgt-gb-row tgt-gb-holes">
          <strong>Hul</strong>
          {holes.map((hole) => <span key={hole.holeNumber}>{hole.holeNumber}</span>)}
          <strong>{totalLabel}</strong>
        </div>
        <div className="tgt-gb-row tgt-gb-muted">
          <strong>Index</strong>
          {holes.map((hole) => <span key={hole.holeNumber}>{hole.strokeIndex ?? "–"}</span>)}
          <strong>–</strong>
        </div>
        <div className="tgt-gb-row tgt-gb-muted">
          <strong>Par</strong>
          {holes.map((hole) => <span key={hole.holeNumber}>{hole.par ?? "–"}</span>)}
          <strong>{ninePar || "–"}</strong>
        </div>
        <div className="tgt-gb-row tgt-gb-score-row">
          <strong>Score</strong>
          {holes.map((hole) => (
            <span key={hole.holeNumber}>
              {hole.strokes === null || hole.strokes === undefined
                ? "–"
                : <span style={getScoreMarkStyle(Number(hole.strokes) - Number(hole.par))}>{hole.strokes}</span>}
            </span>
          ))}
          <strong>{ninePlayed.length ? nineGross : "–"}</strong>
        </div>
        <div className="tgt-gb-row tgt-gb-net-row">
          <strong>Net</strong>
          {holes.map((hole) => (
            <span key={hole.holeNumber} className="tgt-gb-net-cell">
              {hole.netStrokes === null || hole.netStrokes === undefined ? "–" : hole.netStrokes}
              {(Number(hole.strokesReceived) || 0) > 0 && <small>{"•".repeat(Number(hole.strokesReceived))}</small>}
            </span>
          ))}
          <strong>{ninePlayed.length ? nineNet : "–"}</strong>
        </div>
      </div>
    );
  };

  const renderDesktopNine = (holes, label, totalLabel) => {
    const ninePlayed = holes.filter((hole) => hole.strokes !== null && hole.strokes !== undefined);
    const parTotal = holes.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
    const gross = ninePlayed.reduce((sum, hole) => sum + Number(hole.strokes), 0);
    const received = ninePlayed.reduce((sum, hole) => sum + (Number(hole.strokesReceived) || 0), 0);
    const net = ninePlayed.reduce((sum, hole) => sum + Number(hole.netStrokes ?? hole.strokes), 0);
    const result = ninePlayed.reduce((sum, hole) => sum + (Number(hole.toPar) || 0), 0);
    return (
      <div className="tgt-scorecard-nine">
        <div className="tgt-scorecard-nine-title"><strong>{label}</strong><span>{ninePlayed.length}/9 huller</span></div>
        <div className="tgt-scorecard-table-wrap">
          <table className="tgt-scorecard-grid">
            <thead><tr><th>Hul</th>{holes.map((hole) => <th key={hole.holeNumber}>{hole.holeNumber}</th>)}<th>{totalLabel}</th></tr></thead>
            <tbody>
              <tr><th>Index</th>{holes.map((hole) => <td key={hole.holeNumber}>{hole.strokeIndex ?? "–"}</td>)}<td>–</td></tr>
              <tr><th>Par</th>{holes.map((hole) => <td key={hole.holeNumber}>{hole.par ?? "–"}</td>)}<td>{parTotal || "–"}</td></tr>
              <tr><th>Slag</th>{holes.map((hole) => <td key={hole.holeNumber}>{"●".repeat(Number(hole.strokesReceived) || 0) || "–"}</td>)}<td>{received || "–"}</td></tr>
              <tr><th>Score</th>{holes.map((hole) => <td key={hole.holeNumber}>{hole.strokes ?? "–"}</td>)}<td>{ninePlayed.length ? gross : "–"}</td></tr>
              <tr><th>Net</th>{holes.map((hole) => <td key={hole.holeNumber}>{hole.netStrokes ?? "–"}</td>)}<td>{ninePlayed.length ? net : "–"}</td></tr>
              <tr><th>Til par</th>{holes.map((hole) => <td key={hole.holeNumber}>{hole.toPar === null || hole.toPar === undefined ? "–" : formatScore(hole.toPar)}</td>)}<td>{ninePlayed.length ? formatScore(result) : "–"}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="tgt-split-scorecard">
      <div className="tgt-gb-mobile-card">
        {renderMobileNine(normalized.slice(0, 9), "Ud")}
        {renderMobileNine(normalized.slice(9, 18), "Ind")}
        <div className="tgt-gb-footer">
          <span>Par <strong>{totalPar || "–"}</strong></span>
          <span>Score <strong>{played.length ? `${grossTotal}/${netTotal}` : "–"}</strong></span>
          <span>Til par <strong>{played.length ? formatScore(totalToPar) : "–"}</strong></span>
          <span>Position <strong>{position ? `${position}.` : "–"}</strong></span>
        </div>
      </div>
      <div className="tgt-desktop-detailed-scorecard">
        <div className="tgt-scorecard-player-handicap"><span>HCP {handicapIndex ?? "–"}</span><span>SPH {playingHandicap ?? "–"}</span></div>
        {renderDesktopNine(normalized.slice(0, 9), "FOR 9", "UD")}
        {renderDesktopNine(normalized.slice(9, 18), "BAG 9", "IND")}
      </div>
    </div>
  );
}

function ClosestToPinHoleSelector({ roundId, courseId, disabled = false }) {
  const [holes, setHoles] = useState([]);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!roundId || !courseId) {
        if (active) { setHoles([]); setSelected([]); }
        return;
      }
      const [holesResult, selectedResult] = await Promise.all([
        supabase.from("course_holes").select("hole_number, par").eq("course_id", courseId).order("hole_number"),
        supabase.from("round_closest_to_pin_holes").select("hole_number").eq("round_id", roundId).order("hole_number"),
      ]);
      if (!active) return;
      if (holesResult.error || selectedResult.error) {
        setErrorMessage((holesResult.error ?? selectedResult.error).message);
        return;
      }
      const parThreeHoles = (holesResult.data ?? []).filter(
        (hole) => Number(hole.par) === 3
      );
      const savedHoleNumbers = (selectedResult.data ?? []).map((row) =>
        Number(row.hole_number)
      );
      setHoles(parThreeHoles);
      setSelected(
        savedHoleNumbers.length > 0
          ? savedHoleNumbers
          : parThreeHoles.map((hole) => Number(hole.hole_number))
      );
    }
    load();
    return () => { active = false; };
  }, [roundId, courseId]);

  function toggleHole(holeNumber) {
    setSelected((current) => current.includes(holeNumber) ? current.filter((value) => value !== holeNumber) : [...current, holeNumber].sort((a, b) => a - b));
    setMessage("");
  }

  async function save() {
    setSaving(true); setMessage(""); setErrorMessage("");
    const { data, error } = await supabase.rpc("set_round_closest_to_pin_holes", {
      requested_round_id: roundId,
      requested_hole_numbers: selected,
    });
    setSaving(false);
    if (error) { setErrorMessage(error.message); return; }
    setMessage(`${data ?? selected.length} hul${Number(data ?? selected.length) === 1 ? "" : "ler"} gemt til Tættest på pinden.`);
  }

  if (!courseId) return null;
  return (
    <section className="tgt-closest-hole-selector">
      <div><strong>Tættest på pinden-huller</strong><small>Alle banens par 3-huller er valgt automatisk. Fjern kun et hul, hvis det ikke skal tælle med.</small></div>
      <div className="tgt-closest-hole-grid">
        {holes.map((hole) => (
          <label key={hole.hole_number} className={selected.includes(Number(hole.hole_number)) ? "selected" : ""}>
            <input type="checkbox" checked={selected.includes(Number(hole.hole_number))} onChange={() => toggleHole(Number(hole.hole_number))} disabled={disabled} />
            <span>Hul {hole.hole_number}</span><small>Par {hole.par}</small>
          </label>
        ))}
      </div>
      <button type="button" onClick={save} disabled={disabled || saving} className="login-submit-button">{saving ? "Gemmer..." : "Gem valgte huller"}</button>
      {message && <div className="status-box">{message}</div>}
      {errorMessage && <div className="error-box">{errorMessage}</div>}
    </section>
  );
}
function MitTgtBottomNav({ active = "profile", onProfile, onLeaderboard, onPlay, onLive, onMenu, playDisabled = false }) {
  const items = [
    { key: "profile", label: "Profil", action: onProfile, icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.5-4.1 2.7-6.2 6.5-6.2s6 2.1 6.5 6.2"/></svg> },
    { key: "leaderboard", label: "Stilling", action: onLeaderboard, icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8.5 14.5 11 12l2 1.8 3.5-4"/></svg> },
    { key: "play", label: "SPIL", action: onPlay, play: true },
    { key: "live", label: "Live", action: onLive, icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 9-8 9-8-9 8-9Z"/><circle cx="12" cy="12" r="2.2"/></svg> },
    { key: "menu", label: "Menu", action: onMenu, icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg> },
  ];
  return (
    <nav className="tgt-fixed-bottom-nav" aria-label="Mit TGT navigation">
      {items.map((item)=>(
        <button key={item.key} type="button" className={`tgt-fixed-nav-item${item.play ? " tgt-fixed-nav-play" : ""}${active===item.key ? " is-active" : ""}`} onClick={item.action} disabled={item.play && playDisabled} aria-label={item.label} title={item.label}>
          {item.play ? <span className="tgt-fixed-play-disc">SPIL</span> : <><span className="tgt-fixed-nav-icon">{item.icon}</span><small>{item.label}</small></>}
        </button>
      ))}
    </nav>
  );
}

function Leaderboard({ onOpenPlayerLogin, initialPortalView = null, onPortalNavigate = null, isAuthenticated = false }) {
  const [mainTab, setMainTab] = useState(initialPortalView === "team" ? "team" : "individual");
  const [tab, setTab] = useState(initialPortalView === "live-leaderboard" ? "live" : initialPortalView === "team" ? "team" : "season");
  const [selectedSeason, setSelectedSeason] = useState(ACTIVE_SEASON);
  const [availableSeasons] = useState([ACTIVE_SEASON]);
  const [profileSearch, setProfileSearch] = useState("");
  const [directoryPlayerId, setDirectoryPlayerId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [individualFullscreen, setIndividualFullscreen] = useState(initialPortalView === "leaderboard");
  const [teamFullscreen, setTeamFullscreen] = useState(initialPortalView === "team");
  const [liveFullscreen, setLiveFullscreen] = useState(initialPortalView === "live-leaderboard");
  const [liveView, setLiveView] = useState("individual");
  const [panelFullscreen, setPanelFullscreen] = useState(["rounds","profiles","hall","closest"].includes(initialPortalView) ? initialPortalView : null);
  const [standings, setStandings] = useState([]);
  const [liveData, setLiveData] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [closestEntries, setClosestEntries] = useState([]);
  const [approvedBonuses, setApprovedBonuses] = useState([]);
  const [publicScoreEventVersion, setPublicScoreEventVersion] = useState(0);
  const [finalStandingsData, setFinalStandingsData] = useState(null);
  const [hallOfFame, setHallOfFame] = useState([]);
  const [publicRounds, setPublicRounds] = useState([]);
  const [selectedPublicRoundId, setSelectedPublicRoundId] = useState(null);
  const [seasonRoundHistory, setSeasonRoundHistory] = useState({});
  const [expandedHistoricalRoundKey, setExpandedHistoricalRoundKey] = useState(null);
  const [teamRoundHistory, setTeamRoundHistory] = useState({});
  const [historicalTeamStandings, setHistoricalTeamStandings] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [damebajerCounts, setDamebajerCounts] = useState({});
  const [profilePlayerId, setProfilePlayerId] = useState(null);
  const [playerDirectory, setPlayerDirectory] = useState({});
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [selectedPlayerMode, setSelectedPlayerMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase
        .from("season_individual_standings")
        .select(`
          player_id,
          player_name,
          rounds_played,
          counting_rounds,
          counting_score,
          halved_score
        `)
        .eq("season", selectedSeason);

      if (error) throw error;

      const { data: roundRows, error: publicRoundsError } = await supabase
        .from("rounds")
        .select(`
          id,
          round_number,
          name,
          played_at,
          status,
          round_type,
          individual_enabled,
          team_enabled,
          live_leaderboard_mode,
          course_id,
          tee_id,
          courses (club_name, course_name),
          tournaments!inner (season)
        `)
        .eq("tournaments.season", selectedSeason)
        .in("status", ["ready", "live", "submitted", "completed", "locked"])
        .order("round_number", { ascending: true });

      if (publicRoundsError) throw publicRoundsError;
      setPublicRounds(roundRows ?? []);

      const { data: historicalScoreRows, error: historicalScoresError } = await supabase
        .from("scores")
        .select("round_id, player_id, hole_number, strokes")
        .in("round_id", (roundRows ?? []).map((round) => round.id))
        .order("hole_number", { ascending: true });
      if (historicalScoresError) throw historicalScoresError;

      const historicalCourseIds = [
        ...new Set(
          (roundRows ?? [])
            .map((round) => round.course_id)
            .filter(Boolean)
        ),
      ];
      let historicalHoleRows = [];
      if (historicalCourseIds.length > 0) {
        const { data: holeData, error: historicalHolesError } = await supabase
          .from("course_holes")
          .select("course_id, hole_number, par, stroke_index")
          .in("course_id", historicalCourseIds)
          .order("hole_number", { ascending: true });
        if (historicalHolesError) throw historicalHolesError;
        historicalHoleRows = holeData ?? [];
      }

      const holeByCourseAndNumber = new Map(
        historicalHoleRows.map((hole) => [
          `${hole.course_id}-${hole.hole_number}`,
          hole,
        ])
      );
      const historicalScorecards = {};
      (historicalScoreRows ?? []).forEach((score) => {
        const key = `${score.player_id}-${score.round_id}`;
        historicalScorecards[key] ??= [];
        const hole = holeByCourseAndNumber.get(
          `${(roundRows ?? []).find((round) => round.id === score.round_id)?.course_id}-${score.hole_number}`
        );
        const par = hole?.par ?? null;
        historicalScorecards[key].push({
          holeNumber: score.hole_number,
          par,
          strokes: score.strokes,
          toPar:
            par === null || score.strokes === null
              ? null
              : Number(score.strokes) - Number(par),
        });
      });

      // Spillerhistorikken hentes senere via en dedikeret visning.
      // En historikfejl må aldrig blokere det offentlige leaderboard.
      const [individualHistoryResult, teamHistoryResult, damebajerResult, playerDirectoryResult] = await Promise.all([
        supabase
          .from("round_results")
          .select(`
            player_id,
            round_number,
            score,
            players (name),
            tournaments!inner (season)
          `)
          .eq("tournaments.season", selectedSeason)
          .not("score", "is", null)
          .order("round_number", { ascending: true }),
        supabase
          .from("team_round_results")
          .select(`
            team_id,
            round_number,
            score,
            teams (name),
            tournaments!inner (season)
          `)
          .eq("tournaments.season", selectedSeason)
          .not("score", "is", null)
          .order("round_number", { ascending: true }),
        supabase
          .from("damebajere_public")
          .select("player_id, round_id, hole_number"),
        supabase
          .from("players")
          .select(`
            id,
            name,
            handicap_index,
            tournaments!inner (season)
          `)
          .eq("tournaments.season", selectedSeason),
      ]);

      if (individualHistoryResult.error) throw individualHistoryResult.error;
      if (teamHistoryResult.error) throw teamHistoryResult.error;
      if (damebajerResult.error) throw damebajerResult.error;
      if (playerDirectoryResult.error) throw playerDirectoryResult.error;

      setPlayerDirectory(
        Object.fromEntries(
          (playerDirectoryResult.data ?? []).map((playerData) => [
            playerData.id,
            playerData,
          ])
        )
      );

      const nextDamebajerCounts = {};
      (damebajerResult.data ?? []).forEach((entry) => {
        nextDamebajerCounts[entry.player_id] =
          (nextDamebajerCounts[entry.player_id] ?? 0) + 1;
      });
      setDamebajerCounts(nextDamebajerCounts);

      const individualHistoryByPlayer = {};
      (individualHistoryResult.data ?? []).forEach((result) => {
        individualHistoryByPlayer[result.player_id] ??= [];
        const matchingRound = (roundRows ?? []).find(
          (round) => Number(round.round_number) === Number(result.round_number)
        );
        const scorecard = matchingRound
          ? historicalScorecards[`${result.player_id}-${matchingRound.id}`] ?? []
          : [];
        individualHistoryByPlayer[result.player_id].push({
          roundId: matchingRound?.id ?? `historical-${result.round_number}`,
          roundNumber: result.round_number,
          roundName: matchingRound?.name ?? `Runde ${result.round_number}`,
          scoreToPar: result.score,
          holesPlayed: scorecard.length || 18,
          hasScorecard: scorecard.length > 0,
          scorecard,
        });
      });
      setSeasonRoundHistory(individualHistoryByPlayer);

      const teamHistoryById = {};
      (teamHistoryResult.data ?? []).forEach((result) => {
        teamHistoryById[result.team_id] ??= {
          teamId: result.team_id,
          teamName: result.teams?.name ?? "Ukendt hold",
          rounds: [],
        };
        teamHistoryById[result.team_id].rounds.push({
          roundNumber: result.round_number,
          score: result.score,
        });
      });
      setTeamRoundHistory(teamHistoryById);

      const teamStandings = Object.values(teamHistoryById)
        .map((team) => {
          const manualBase = getManualFinalBase(team.rounds.map((round)=>round.score));
          const bestFour = manualBase.usedScores;
          const countingScore = manualBase.countingScore;
          return {
            ...team,
            roundsPlayed: team.rounds.length,
            countingScore,
            halvedScore: null,
          };
        })
        .sort((a, b) =>
          Number(a.halvedScore ?? a.countingScore ?? Infinity) !== Number(b.halvedScore ?? b.countingScore ?? Infinity)
            ? Number(a.halvedScore ?? a.countingScore ?? Infinity) - Number(b.halvedScore ?? b.countingScore ?? Infinity)
            : a.teamName.localeCompare(b.teamName, "da")
        );
      setHistoricalTeamStandings(teamStandings);

      const teamFinalRound = (roundRows ?? []).find(
        (round) => round.round_type === "team_final"
      );
      const individualFinalRound = (roundRows ?? []).find(
        (round) => round.round_type === "individual_final"
      );

      let [currentLiveData, currentTeamData] = await Promise.all([
        getLiveRoundLeaderboard({ season: selectedSeason }),
        teamFinalRound
          ? getTeamLeaderboard({
              season: selectedSeason,
              roundNumber: teamFinalRound.round_number,
            })
          : Promise.resolve(null),
      ]);

      let currentLiveRound = (roundRows ?? []).find(
        (round) => round.id === currentLiveData?.round?.id
      );
      if (!currentLiveRound || currentLiveRound.status !== "live") {
        currentLiveData = null;
        currentTeamData = null;
        currentLiveRound = null;
      }
      const liveTeeId =
        currentLiveData?.round?.teeId ??
        currentLiveData?.round?.tee_id ??
        currentLiveRound?.tee_id;

      if (currentLiveData?.round && liveTeeId) {
        const { data: liveTee, error: liveTeeError } = await supabase
          .from("course_tees")
          .select("id, tee_name, course_rating, slope_rating")
          .eq("id", liveTeeId)
          .maybeSingle();
        if (liveTeeError) throw liveTeeError;
        currentLiveData = {
          ...currentLiveData,
          round: {
            ...currentLiveData.round,
            tee: liveTee ?? null,
            holes: currentLiveData.holes ?? [],
            liveLeaderboardMode: currentLiveRound?.live_leaderboard_mode ?? "none",
          },
        };
      }

      if (currentLiveData?.round && !currentLiveData.round.holes) {
        currentLiveData = {
          ...currentLiveData,
          round: {
            ...currentLiveData.round,
            holes: currentLiveData.holes ?? [],
            liveLeaderboardMode: currentLiveRound?.live_leaderboard_mode ?? "none",
          },
        };
      }
      const currentClosestEntries = currentLiveData?.round?.id
        ? await getClosestToPinEntries(currentLiveData.round.id)
        : [];

      let currentApprovedBonuses = [];

      if (currentLiveData?.round?.id) {
        const { data: bonusRows, error: bonusError } = await supabase
          .from("closest_to_pin")
          .select(`
            id,
            round_id,
            hole_number,
            player_id,
            bonus_strokes,
            approved
          `)
          .eq("round_id", currentLiveData.round.id)
          .eq("approved", true);

        if (bonusError) throw bonusError;
        currentApprovedBonuses = bonusRows ?? [];
      }

      setStandings(sortStandings(data));
      setLiveData(currentLiveData);
      setTeamData(currentTeamData);
      setClosestEntries(currentClosestEntries);
      setApprovedBonuses(currentApprovedBonuses);

      try {
        const currentHallOfFame = await getFormattedHallOfFame();
        setHallOfFame(currentHallOfFame);
      } catch (hallError) {
        console.error("Hall of Fame kunne ikke hentes:", hallError);
        setHallOfFame([]);
      }

      try {
        if (!teamFinalRound || !individualFinalRound) {
          setFinalStandingsData(null);
        } else {
          const currentFinalStandings = await getFinalStandings({
            season: selectedSeason,
            roundSixNumber: teamFinalRound.round_number,
            roundSevenNumber: individualFinalRound.round_number,
          });
          setFinalStandingsData(currentFinalStandings);
        }
      } catch (finalError) {
        console.error(
          "Finalestillingen kunne ikke hentes:",
          finalError
        );
        setFinalStandingsData(null);
      }
    } catch (error) {
      console.error("Fejl ved hentning af TGT-data:", error);
      setErrorMessage(error.message ?? "Data kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, [selectedSeason]);

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel("tgt-public-leaderboards")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        async (payload) => {
          await loadData();
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            setPublicScoreEventVersion((current) => current + 1);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "closest_to_pin_entries",
        },
        loadData
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "closest_to_pin",
        },
        loadData
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const liveLeaderboard = sortIndividualLeaderboard(
    applyIndividualBonuses({
      leaderboard: normalizeIndividualLiveLeaderboard(
        liveData?.leaderboard ?? [],
        liveData?.round ?? null
      ),
      approvedBonuses,
    })
  );
  const liveLeaderboardMode =
    liveData?.round?.liveLeaderboardMode ??
    liveData?.round?.live_leaderboard_mode ??
    "none";
  const individualLiveCumulativeActive = ["individual", "both"].includes(liveLeaderboardMode);
  const teamLiveCumulativeActive = ["team", "both"].includes(liveLeaderboardMode);
  const liveCumulativeActive = individualLiveCumulativeActive || teamLiveCumulativeActive;
  const cumulativeStandings = individualLiveCumulativeActive && finalStandingsData?.standings?.length
    ? [...finalStandingsData.standings]
        .map((player) => ({
          player_id: player.playerId,
          player_name: player.playerName,
          counting_score: player.finalScore ?? player.startingScore,
          live_holes:
            liveData?.round?.round_type === "individual_final"
              ? player.roundSevenHoles
              : player.roundSixHoles,
        }))
        .sort((a, b) => {
          const scoreDifference = Number(a.counting_score ?? Infinity) - Number(b.counting_score ?? Infinity);
          return scoreDifference || a.player_name.localeCompare(b.player_name, "da");
        })
    : standings;
  const teamLeaderboard = normalizeTeamLiveLeaderboard(
    teamData?.leaderboard ?? [],
    liveLeaderboard
  );
  const liveTeamById = new Map(
    teamLeaderboard.map((team) => [team.teamId ?? team.id, team])
  );
  const cumulativeTeamStandings = teamLiveCumulativeActive
    ? historicalTeamStandings
        .map((team) => {
          const liveTeam = liveTeamById.get(team.teamId);
          const liveScore = getTeamScoreToPar(liveTeam);
          const liveHoles = liveTeam?.holesPlayed ?? liveTeam?.thru ?? 0;
          return {
            ...team,
            liveScore: liveHoles > 0 && liveScore !== null ? liveScore : 0,
            liveHoles,
            cumulativeScore:
              Number(team.halvedScore ?? 0) +
              (liveHoles > 0 && liveScore !== null ? Number(liveScore) : 0),
          };
        })
        .sort((a, b) =>
          a.cumulativeScore !== b.cumulativeScore
            ? a.cumulativeScore - b.cumulativeScore
            : a.teamName.localeCompare(b.teamName, "da")
        )
    : historicalTeamStandings;
  const cumulativeIndividualMovements = usePositionChanges(cumulativeStandings, (player) => player.player_id, publicScoreEventVersion);
  const cumulativeTeamMovements = usePositionChanges(cumulativeTeamStandings, (team) => team.teamId, publicScoreEventVersion);
  const publicIndividualTopFive = cumulativeStandings.slice(0, 5).map((player) => ({
    id: player.player_id,
    name: player.player_name,
    score: player.counting_score,
    holesPlayed: player.live_holes ?? 0,
    movement: cumulativeIndividualMovements[String(player.player_id)] ?? 0,
  }));
  const publicTeamTopFive = cumulativeTeamStandings.slice(0, 5).map((team) => ({
    id: team.teamId,
    name: team.teamName,
    score: teamLiveCumulativeActive ? team.cumulativeScore : team.halvedScore,
    holesPlayed: team.liveHoles ?? 0,
    movement: cumulativeTeamMovements[String(team.teamId)] ?? 0,
  }));
  function PublicLiveTopFive({ type }) {
    const isTeam = type === "team";
    const entries = isTeam ? publicTeamTopFive : publicIndividualTopFive;
    return (
      <section className="tgt-public-live-top-five">
        <header>
          <span className="live-dot" />
          <strong>{isTeam ? "SAMLET HOLDSTILLING LIVE" : "SAMLET INDIVIDUEL STILLING LIVE"}</strong>
          <small>TOP 5</small>
        </header>
        <div className="tgt-public-live-top-five-list">
          {entries.map((entry, index) => (
            <div className="tgt-public-live-top-five-row" key={entry.id ?? `${entry.name}-${index}`}>
              <span className={`position-badge position-${index + 1}`}>{index + 1}</span>
              <strong>{entry.name}</strong>
              <span className="tgt-score-with-movement">
                <span>{formatScore(entry.score)}</span>
                <PositionMovement value={entry.movement} />
              </span>
              <small>{entry.holesPlayed}/18</small>
            </div>
          ))}
          {entries.length === 0 && <p>Afventer live scores</p>}
        </div>
      </section>
    );
  }
  const closestLeaders = calculateClosestToPinLeaders(
    closestEntries
  );
  const parThreeHoles = (liveData?.holes ?? []).filter(
    (hole) => Number(hole.par) === 3
  );

  async function openRoundClosest(round) {
    if (!round?.id) return;

    setLoading(true);
    setErrorMessage("");
    setSelectedPlayer(null);
    setSelectedPlayerMode(null);

    try {
      const [roundLeaderboard, roundClosestEntries] = await Promise.all([
        getLiveRoundLeaderboard({ season: selectedSeason, roundId: round.id }),
        getClosestToPinEntries(round.id),
      ]);
      setSelectedPublicRoundId(round.id);
      setLiveData(roundLeaderboard);
      setClosestEntries(roundClosestEntries ?? []);
      setMainTab("individual");
      setTab("closest");
      setPanelFullscreen("closest");
    } catch (error) {
      console.error("Tættest på pinden kunne ikke åbnes:", error);
      setErrorMessage(error.message ?? "Tættest på pinden kunne ikke åbnes.");
    } finally {
      setLoading(false);
    }
  }

  async function openRound(round) {
    if (!round?.id) return;

    setLoading(true);
    setErrorMessage("");
    setSelectedPlayer(null);
    setSelectedPlayerMode(null);

    try {
      let roundLeaderboard = await getLiveRoundLeaderboard({
        season: selectedSeason,
        roundId: round.id,
      });
      const selectedTeeId = roundLeaderboard?.round?.teeId ?? roundLeaderboard?.round?.tee_id ?? round.tee_id;
      let selectedTee = roundLeaderboard?.round?.tee ?? null;
      if (selectedTeeId && !selectedTee) {
        const { data: teeData, error: teeError } = await supabase
          .from("course_tees")
          .select("id, tee_name, course_rating, slope_rating")
          .eq("id", selectedTeeId)
          .maybeSingle();
        if (teeError) throw teeError;
        selectedTee = teeData ?? null;
      }
      roundLeaderboard = {
        ...roundLeaderboard,
        round: {
          ...roundLeaderboard?.round,
          tee: selectedTee,
          holes: roundLeaderboard?.holes ?? [],
          liveLeaderboardMode: round.live_leaderboard_mode ?? "none",
        },
      };
      setSelectedPublicRoundId(round.id);
      setLiveData(roundLeaderboard);
      setMainTab("individual");
      setTab("live");
    } catch (error) {
      console.error("Runden kunne ikke åbnes:", error);
      setErrorMessage(error.message ?? "Runden kunne ikke åbnes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!menuOpen) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("tgt-menu-open");
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("tgt-menu-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  function switchSeason(season) {
    if (Number(season) !== ACTIVE_SEASON) return;
    setSelectedSeason(ACTIVE_SEASON);
    setSelectedPlayer(null);
    setSelectedTeamId(null);
    setProfilePlayerId(null);
    setDirectoryPlayerId(null);
    setMainTab("individual");
    setTab("season");
    setMenuOpen(false);
  }

  function openPublicView(nextMainTab, nextTab) {
    setMainTab(nextMainTab);
    setTab(nextTab);
    setMenuOpen(false);
  }

  function openPublicHome() {
    setIndividualFullscreen(false); setTeamFullscreen(false); setLiveFullscreen(false); setPanelFullscreen(null); setMenuOpen(false); setSelectedPlayer(null); setSelectedPlayerMode(null); setSelectedTeamId(null);
  }
  function openIndividualFullscreen() {
    setMainTab("individual");
    setTab("season");
    setIndividualFullscreen(true);
    setMenuOpen(false);
  }

  function closeIndividualFullscreen() {
    setIndividualFullscreen(false);
    setSelectedPlayer(null);
    setSelectedPlayerMode(null);
  }

  function openTeamFullscreen() {
    setMainTab("team");
    setTab("team");
    setTeamFullscreen(true);
    setMenuOpen(false);
  }

  function closeTeamFullscreen() {
    setTeamFullscreen(false);
    setSelectedTeamId(null);
  }

  function openLiveFullscreen(defaultView = "individual") {
    setMainTab("individual");
    setTab("live");
    setLiveView(defaultView);
    setLiveFullscreen(true);
    setMenuOpen(false);
    setSelectedPlayer(null);
    setSelectedPlayerMode(null);
  }

  function closeLiveFullscreen() {
    setLiveFullscreen(false);
    setLiveView("individual");
    setSelectedPlayer(null);
    setSelectedPlayerMode(null);
  }

  function openPanelFullscreen(panel) {
    setMainTab("individual");
    setTab(panel);
    setPanelFullscreen(panel);
    setMenuOpen(false);
  }

  function closePanelFullscreen() {
    setPanelFullscreen(null);
    setSelectedPlayer(null);
    setSelectedPlayerMode(null);
    setProfilePlayerId(null);
    setDirectoryPlayerId(null);
  }

  useEffect(() => {
    if (!individualFullscreen && !teamFullscreen && !liveFullscreen && !panelFullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [individualFullscreen, teamFullscreen, liveFullscreen, panelFullscreen]);

  const headings = {
    season: {
      eyebrow: "Individuel turnering",
      title: individualLiveCumulativeActive ? "Samlet individuel stilling live" : "Aktuel stilling",
      description: individualLiveCumulativeActive
        ? `Den individuelle placering inkluderer ${liveData?.round?.name ?? "den valgte runde"} og opdateres automatisk hul for hul.`
        : "De fire laveste rundescores tæller. Scoren halveres først manuelt af administratoren før finalen.",
    },
    live: {
      eyebrow: "Live fra sæsonen",
      title: liveData?.round?.name ?? "Ingen aktiv runde",
      description: liveData?.round
        ? "Nettoscoren vises i forhold til par og opdateres automatisk, når et hul gemmes."
        : "Livescore vises automatisk, når en runde er sat til live.",
    },
    team: {
      eyebrow: "Holdturnering",
      title: "Aktuel stilling",
      description:
        "100 % spillehandicap. På hvert hul tæller holdets bedste nettoscore. Hullet tæller først, når begge holdspillere har afleveret score.",
    },
    closest: {
      eyebrow: "Par 3-konkurrencen",
      title: "Tættest på pinden",
      description:
        "Den korteste registrerede afstand på hvert par 3-hul vises som den aktuelle fører.",
    },
    final: {
      eyebrow: "Individuel finale",
      title: finalStandingsData?.finalCompleted
        ? "Endelig TGT-stilling"
        : "Foreløbig TGT-stilling",
      description:
        "Halveret grundspil plus officiel score fra Runde 6 og Runde 7. Godkendte bonusser indgår kun efter 18 huller i den relevante runde.",
    },
    profiles: {
      eyebrow: `TGT ${selectedSeason}`,
      title: "Spillerprofiler",
      description: "Se alle spillere samlet og åbn deres profil uden at gå gennem leaderboardet.",
    },
    rounds: {
      eyebrow: `TGT ${selectedSeason}`,
      title: "Sæsonens runder",
      description:
        "Se startlister, følg publicerede runder live og find officielle resultater.",
    },
    hall: {
      eyebrow: "TGT historik",
      title: "Hall of Fame",
      description:
        "Permanente mestre fra afsluttede TGT-sæsoner.",
    },
  };

  const currentHeading = headings[tab];

  return (
    <div className={`app tgt-public-shell${onPortalNavigate ? " tgt-mit-tgt-universe" : ""}${individualFullscreen ? " tgt-individual-fullscreen-open" : ""}${teamFullscreen ? " tgt-team-fullscreen-open" : ""}${liveFullscreen ? " tgt-live-fullscreen-open" : ""}${panelFullscreen ? " tgt-panel-fullscreen-open" : ""}`}>
      <style>{`
        .tgt-public-shell { background: #eef5f0; min-height: 100vh; } .tgt-mit-tgt-universe{padding-bottom:calc(96px + env(safe-area-inset-bottom))!important}
        .tgt-mit-tgt-universe .main-content{padding-bottom:calc(28px + env(safe-area-inset-bottom))!important}.tgt-nav-glyph{position:relative!important;width:24px!important;height:24px!important;display:block!important;color:currentColor!important}.tgt-nav-profile:before{content:"";position:absolute;left:8px;top:2px;width:8px;height:8px;border:2px solid currentColor;border-radius:50%}.tgt-nav-profile:after{content:"";position:absolute;left:4px;bottom:1px;width:16px;height:9px;border:2px solid currentColor;border-radius:12px 12px 5px 5px}.tgt-nav-circle{border:2px solid currentColor;border-radius:50%;box-shadow:inset 0 0 0 4px transparent}.active .tgt-nav-circle{box-shadow:inset 0 0 0 5px currentColor}.tgt-nav-diamond{width:17px!important;height:17px!important;margin:3px!important;border:2px solid currentColor;transform:rotate(45deg);border-radius:2px}.active .tgt-nav-diamond{background:currentColor}.tgt-nav-menu:before,.tgt-nav-menu:after,.tgt-nav-menu{border-top:2px solid currentColor}.tgt-nav-menu:before,.tgt-nav-menu:after{content:"";position:absolute;left:0;width:24px}.tgt-nav-menu:before{top:6px}.tgt-nav-menu:after{top:14px}.tgt-mobile-bottom-nav .tgt-bottom-play{overflow:visible!important}.tgt-mobile-bottom-nav .tgt-bottom-play-icon{width:56px!important;height:56px!important;display:grid!important;place-items:center!important;border:2px solid #ffffff!important;border-radius:50%!important;color:#063326!important;background:linear-gradient(145deg,#eaf5ee,#168454)!important;box-shadow:0 8px 22px rgba(0,0,0,.28)!important;font-size:13px!important;font-weight:1000!important;letter-spacing:.08em!important;transform:translateY(-10px)!important}.tgt-mobile-bottom-nav{position:fixed!important;left:50%!important;right:auto!important;bottom:0!important;z-index:120!important;width:min(620px,100%)!important;height:calc(64px + env(safe-area-inset-bottom))!important;display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;align-items:center!important;transform:translateX(-50%)!important;padding:5px 8px calc(5px + env(safe-area-inset-bottom))!important;border-top:1px solid rgba(255,255,255,.26)!important;background:rgba(4,37,27,.985)!important;box-shadow:0 -10px 30px rgba(2,24,17,.22)!important;backdrop-filter:blur(18px)!important;overflow:visible!important}.tgt-mobile-bottom-nav button{position:relative;min-width:0!important;height:50px!important;min-height:50px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;padding:3px 1px!important;border:0!important;border-radius:13px!important;background:transparent!important;color:rgba(255,255,255,.62)!important;font-weight:900!important;cursor:pointer!important}.tgt-mobile-bottom-nav button>span:not(.tgt-bottom-play-icon){height:19px;display:grid;place-items:center;font-size:17px;line-height:1}.tgt-mobile-bottom-nav button small{display:none!important}.tgt-mobile-bottom-nav button.active{color:#ffffff!important;background:rgba(255,255,255,.08)!important}.tgt-mobile-bottom-nav .tgt-bottom-play{align-self:center!important;width:58px!important;height:58px!important;min-height:58px!important;justify-self:center!important;margin:-17px auto 0!important;padding:0!important;border-radius:50%!important;background:transparent!important}.tgt-bottom-play-icon{width:54px;height:54px;display:grid;place-items:center;border:2px solid #ffffff;border-radius:50%;background:linear-gradient(145deg,#39a86f,#08794c);box-shadow:0 7px 19px rgba(0,0,0,.28),0 0 0 4px rgba(4,37,27,.985);font-size:23px;line-height:1}.tgt-mobile-bottom-nav .tgt-bottom-play small{display:none!important}
        @media (max-width:700px){
          .tgt-public-shell,.tgt-player-shell{padding-bottom:calc(78px + env(safe-area-inset-bottom))!important}
          .tgt-mobile-bottom-nav{position:fixed!important;display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;grid-template-rows:56px!important;align-items:center!important;left:0!important;right:0!important;bottom:0!important;width:100%!important;max-width:none!important;height:calc(64px + env(safe-area-inset-bottom))!important;min-height:64px!important;margin:0!important;padding:4px 8px calc(4px + env(safe-area-inset-bottom))!important;transform:none!important;border-radius:0!important;overflow:visible!important;background:rgba(4,37,27,.985)!important}
          .tgt-mobile-bottom-nav button{display:grid!important;place-items:center!important;position:relative!important;width:100%!important;min-width:0!important;max-width:none!important;height:50px!important;min-height:50px!important;margin:0!important;padding:0!important;flex:0 0 auto!important;border-radius:12px!important;color:rgba(255,255,255,.65)!important;background:transparent!important}
          .tgt-mobile-bottom-nav button.active{color:#ffffff!important;background:rgba(255,255,255,.08)!important}
          .tgt-mobile-bottom-nav button small{display:none!important}
          .tgt-mobile-bottom-nav .tgt-bottom-play{display:grid!important;place-items:center!important;justify-self:center!important;align-self:center!important;width:56px!important;min-width:56px!important;max-width:56px!important;height:56px!important;min-height:56px!important;margin:-18px auto 0!important;padding:0!important;border-radius:50%!important;background:transparent!important}
          .tgt-mobile-bottom-nav .tgt-bottom-play small{display:none!important}
          .tgt-bottom-play-icon{width:52px!important;height:52px!important;font-size:22px!important;border-width:2px!important}
          .tgt-player-head{padding:16px 14px!important}
          .tgt-player-head h1{font-size:36px!important;line-height:1.02!important}
          .tgt-player-actions{width:auto!important;align-self:stretch!important}
          .tgt-player-actions button{width:100%!important;min-height:42px!important}
          .tgt-player-intro{gap:12px!important;padding:2px 2px!important}
          .tgt-player-avatar{width:48px!important;height:48px!important;min-width:48px!important;font-size:17px!important}
          .tgt-player-primary{min-height:48px!important;margin:10px 0 2px!important;font-size:15px!important}
          .tgt-player-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important;margin:11px 0 14px!important}
          .tgt-player-kpi{min-height:78px!important;padding:10px!important;border-radius:14px!important}
          .tgt-player-kpi span{font-size:9px!important;letter-spacing:.08em!important}
          .tgt-player-kpi strong{font-size:19px!important}
          .tgt-player-grid{grid-template-columns:1fr!important;gap:12px!important}
        }

        .tgt-public-topbar { position: relative; z-index: 30; display: flex; align-items: center; justify-content: space-between; padding: 14px clamp(18px, 4vw, 54px); background: rgba(7, 43, 31, .96); color: #fff; backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,.12); }
        .tgt-public-shell main { width: 100%; }
        .tgt-public-shell .leaderboard-card { width: min(1180px, calc(100% - 32px)); margin-left: auto; margin-right: auto; }
        .tgt-premium-hero { text-align: center; }
        .tgt-hero-inner { display: flex; flex-direction: column; align-items: center; }
        .tgt-premium-hero h1 { margin-left: auto; margin-right: auto; }
        .tgt-hero-meta, .tgt-hero-actions { justify-content: center; }
        .tgt-hof-grid { width: min(1040px, 100%); margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 22px; }
        .tgt-hof-card { position: relative; overflow: hidden; min-height: 430px; padding: 26px; border-radius: 24px; border: 1px solid rgba(255,255,255,.58); color: #f3d98f; background: radial-gradient(circle at 50% 0%, rgba(255,255,255,.18), transparent 26%), radial-gradient(circle at 110% 90%, rgba(22,132,84,.18), transparent 36%), linear-gradient(150deg, #031f17 0%, #073c2b 55%, #0a5039 100%); box-shadow: 0 24px 65px rgba(3,31,23,.24), inset 0 1px 0 rgba(255,255,255,.12); transition: transform .2s ease, box-shadow .2s ease; }
        .tgt-hof-card:hover { transform: translateY(-4px); box-shadow: 0 32px 78px rgba(3,31,23,.30), inset 0 1px 0 rgba(255,255,255,.16); }
        .tgt-hof-card:before { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 20%, rgba(255,255,255,.08) 43%, transparent 62%); }
        .tgt-hof-top { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 24px; }
        .tgt-hof-trophy { width: 94px; height: 94px; display: grid; place-items: center; margin-bottom: 14px; border-radius: 50%; border: 1px solid rgba(255,255,255,.76); background: radial-gradient(circle at 32% 22%, #fff0ae 0%, #d9ad51 42%, #9d691d 100%); box-shadow: 0 14px 36px rgba(211,165,73,.32), 0 0 0 8px rgba(255,255,255,.06); font-size: 48px; }
        .tgt-hof-year { margin: 0; font-family: Georgia, serif; font-size: clamp(48px, 7vw, 68px); line-height: .95; letter-spacing: -.04em; background: linear-gradient(112deg, #168454 0%, #39a86f 25%, #ffffff 50%, #168454 75%, #eaf5ee 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 6px 18px rgba(0,0,0,.22)); }
        .tgt-hof-kicker { margin: 8px 0 0; color: #dff0e5; font-size: 10px; font-weight: 900; letter-spacing: .22em; text-transform: uppercase; }
        .tgt-hof-winner { position: relative; padding: 17px 18px; border-radius: 16px; border: 1px solid rgba(255,255,255,.28); background: rgba(1,24,17,.48); text-align: center; }
        .tgt-hof-winner + .tgt-hof-winner { margin-top: 12px; }
        .tgt-hof-winner span { display: block; margin-bottom: 7px; color: #c6a75d; font-size: 10px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
        .tgt-hof-winner strong { display: block; color: #ffffff; font-family: Georgia, serif; font-size: 21px; line-height: 1.2; }
        .tgt-hof-course { position: relative; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 18px; padding-top: 17px; border-top: 1px solid rgba(255,255,255,.22); color: rgba(255,255,255,.72); font-size: 13px; font-weight: 700; text-align: center; }

        .tgt-wordmark { display: flex; align-items: center; gap: 12px; font-weight: 900; letter-spacing: .12em; color: #e8c66f; }
        .tgt-profile-kpis {
          gap: 12px !important;
          padding: 0 !important;
          background: transparent !important;
        }
        .tgt-profile-kpis > div {
          min-height: 92px;
          display: flex !important;
          flex-direction: column;
          align-items: flex-start !important;
          justify-content: center;
          gap: 10px;
          padding: 16px 18px !important;
          background: linear-gradient(145deg, #073727, #0a4935) !important;
          border: 1px solid rgba(255, 255, 255, .42) !important;
          border-radius: 14px !important;
          color: #ffffff !important;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .05);
        }
        .tgt-profile-kpis > div span {
          color: #dff0e5 !important;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .09em;
          text-transform: uppercase;
        }
        .tgt-profile-kpis > div strong {
          color: #ffffff !important;
          font-size: 24px;
          line-height: 1;
        }
        .tgt-public-shell {
          background:
            radial-gradient(circle at 12% 5%, rgba(22,132,84,.10), transparent 25%),
            linear-gradient(180deg, #eef5f0 0%, #f7faf7 45%, #e7f1ea 100%) !important;
        }
        .tgt-premium-hero {
          min-height: 430px;
          display: flex;
          align-items: center;
          background:
            radial-gradient(circle at 82% 18%, rgba(57,168,111,.25), transparent 22%),
            radial-gradient(circle at 68% 80%, rgba(23,113,77,.32), transparent 35%),
            linear-gradient(135deg, #031f17 0%, #073b2a 50%, #0b5239 100%) !important;
          border-bottom: 1px solid rgba(255,255,255,.35);
        }
        .tgt-hero-inner { position: relative; z-index: 2; width: min(1180px, 100%); }
        .tgt-hero-live {
          border: 1px solid rgba(255,255,255,.4) !important;
          background: rgba(3,31,23,.66) !important;
          box-shadow: 0 18px 50px rgba(0,0,0,.18);
        }
        .tgt-public-card {
          border: 1px solid rgba(25,65,48,.10) !important;
          border-radius: 24px !important;
          overflow: hidden;
          box-shadow: 0 22px 70px rgba(18,48,36,.12) !important;
        }
        .tgt-season-leaderboard table { border-collapse: separate; border-spacing: 0 8px; padding: 8px 12px 16px; }
        .tgt-season-leaderboard thead th { border: 0; color: #7b846f; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
        .tgt-season-leaderboard tbody > tr:not(:has(td[colspan])) > td {
          background: #ffffff;
          border-top: 1px solid rgba(33,72,55,.08);
          border-bottom: 1px solid rgba(33,72,55,.08);
          padding-top: 17px;
          padding-bottom: 17px;
        }
        .tgt-season-leaderboard tbody > tr:not(:has(td[colspan])) > td:first-child { border-left: 1px solid rgba(33,72,55,.08); border-radius: 14px 0 0 14px; }
        .tgt-season-leaderboard tbody > tr:not(:has(td[colspan])) > td:last-child { border-right: 1px solid rgba(33,72,55,.08); border-radius: 0 14px 14px 0; }
        .tgt-season-leaderboard tbody > tr:not(:has(td[colspan])):hover > td { background: #f5efe0; }
        .tgt-season-leaderboard .player-name { color: #103d2d; font-size: 16px; }
        .tgt-season-leaderboard .final-score { color: #0b6543; font-size: 19px; }
        .tgt-team-leaderboard table {
          border-collapse: separate;
          border-spacing: 0 8px;
          padding: 8px 12px 16px;
        }
        .tgt-team-leaderboard thead th {
          border: 0;
          color: #7b846f;
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
        }
        .tgt-team-leaderboard tbody > tr:not(:has(td[colspan])) > td {
          padding-top: 17px;
          padding-bottom: 17px;
          background: #ffffff;
          border-top: 1px solid rgba(33,72,55,.08);
          border-bottom: 1px solid rgba(33,72,55,.08);
        }
        .tgt-team-leaderboard tbody > tr:not(:has(td[colspan])) > td:first-child {
          border-left: 1px solid rgba(33,72,55,.08);
          border-radius: 14px 0 0 14px;
        }
        .tgt-team-leaderboard tbody > tr:not(:has(td[colspan])) > td:last-child {
          border-right: 1px solid rgba(33,72,55,.08);
          border-radius: 0 14px 14px 0;
        }
        .tgt-team-profile {
          margin: 8px 12px 18px;
          padding: 20px;
          border: 1px solid rgba(255,255,255,.44);
          border-radius: 20px;
          color: #ffffff;
          background:
            radial-gradient(circle at 100% 0%, rgba(255,255,255,.14), transparent 34%),
            linear-gradient(145deg, #04251b, #0a4935);
          box-shadow: 0 16px 38px rgba(3,31,23,.18);
        }
        .tgt-team-profile-header {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 18px;
        }
        .tgt-team-avatar {
          width: 64px;
          height: 64px;
          min-width: 64px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          color: #123629;
          background: linear-gradient(135deg, #39a86f, #08794c);
          border: 2px solid #ffffff;
          font-family: Georgia, serif;
          font-size: 18px;
          font-weight: 900;
          box-shadow: 0 8px 24px rgba(22,132,84,.24);
        }
        .tgt-team-rounds {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px;
        }
        .tgt-team-round {
          min-height: 82px;
          padding: 13px 14px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          border-radius: 14px;
          background: rgba(2,27,20,.54);
          border: 1px solid rgba(255,255,255,.24);
        }
        .tgt-team-round span { color: #dff0e5; font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
        .tgt-team-round strong { color: #ffffff; font-size: 22px; }
        .tgt-team-final-kpi {
          margin-top: 14px;
          padding: 15px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          border-radius: 14px;
          background: linear-gradient(135deg, rgba(22,132,84,.18), rgba(7,55,39,.72));
          border: 1px solid rgba(255,255,255,.42);
        }
        .tgt-team-final-kpi span { color: #dff0e5; font-weight: 800; }
        .tgt-team-final-kpi strong { color: #ffffff; font-size: 24px; }
        .tgt-profile-directory {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 16px;
        }
        .tgt-profile-directory-card {
          position: relative;
          overflow: hidden;
          padding: 18px !important;
          border-radius: 20px !important;
          background:
            radial-gradient(circle at 100% 0%, rgba(255,255,255,.15), transparent 36%),
            linear-gradient(145deg, #05271d, #0a4935) !important;
          border: 1px solid rgba(255,255,255,.38) !important;
          box-shadow: 0 14px 38px rgba(3,31,23,.16);
          transition: transform .18s ease, box-shadow .18s ease;
        }
        .tgt-profile-directory-card:hover { transform: translateY(-2px); box-shadow: 0 20px 48px rgba(3,31,23,.22); }
        .tgt-directory-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 16px; }
        .tgt-directory-stat {
          min-height: 64px;
          padding: 10px 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 12px;
          background: rgba(2,27,20,.52);
          border: 1px solid rgba(255,255,255,.22);
        }
        .tgt-directory-stat strong { color: #ffffff; font-size: 18px; }
        .tgt-directory-stat small { color: #dff0e5; font-size: 9px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
        @media (max-width: 680px) {
          .tgt-premium-hero { min-height: 360px; }
          .tgt-public-card { border-radius: 18px !important; }
          .tgt-profile-directory { grid-template-columns: 1fr; }
          .tgt-season-leaderboard table,
          .tgt-team-leaderboard table { padding: 5px 6px 12px; border-spacing: 0 6px; }
          .tgt-team-profile { margin: 6px 6px 14px; padding: 16px; border-radius: 16px; }
          .tgt-team-rounds { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .tgt-team-final-kpi { align-items: flex-start; flex-direction: column; }
        }
        .tgt-position-cell { display: flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap; }
        .tgt-position-movement { display:inline-flex; align-items:center; justify-content:center; min-width:28px; padding:3px 5px; border-radius:999px; font-size:10px; font-weight:900; line-height:1; transition:color .2s ease, background .2s ease, transform .2s ease; }
        .tgt-position-movement.up { color:#126d3e; background:#e4f5e9; }
        .tgt-position-movement.down { color:#9d2f29; background:#fde9e7; }
        .tgt-score-with-movement { display:inline-flex; align-items:center; justify-content:flex-end; gap:5px; min-width:0; }
        .tgt-score-with-movement > span:first-child { font-weight:900; }
        .tgt-public-live-top-five { position: sticky; top: 0; z-index: 24; width: min(760px, calc(100% - 24px)); margin: 12px auto; overflow: hidden; border: 1px solid rgba(255,255,255,.48); border-radius: 18px; background: #ffffff; box-shadow: 0 14px 34px rgba(18,48,36,.15); }
        .tgt-public-live-top-five > header { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; padding: 11px 14px; color: #ffffff; background: linear-gradient(135deg,#04251b,#0a4935); }
        .tgt-public-live-top-five > header strong { font-size: 12px; letter-spacing: .08em; }
        .tgt-public-live-top-five > header small { color: #dff0e5; font-size: 9px; font-weight: 900; }
        .tgt-public-live-top-five-list { padding: 5px 10px; }
        .tgt-public-live-top-five-row { display: grid; grid-template-columns: 34px minmax(0,1fr) 70px 44px; align-items: center; gap: 9px; min-height: 40px; border-bottom: 1px solid #e7ece8; }
        .tgt-public-live-top-five-row:last-child { border-bottom: 0; }
        .tgt-public-live-top-five-row .position-badge { width: 26px; height: 26px; min-width: 26px; font-size: 11px; }
        .tgt-public-live-top-five-row > strong { overflow: hidden; color: #173d2e; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
        .tgt-public-live-top-five-row > span:nth-last-child(2) { color: #0b6543; font-weight: 900; text-align: right; }
        .tgt-public-live-top-five-row > small { color: #78827d; font-size: 10px; font-weight: 800; text-align: right; }
        .tgt-public-live-top-five-list p { margin: 10px; color: #78827d; text-align: center; }
        @media (max-width: 600px) { .tgt-public-live-top-five { top: 0; width: calc(100% - 12px); margin: 6px auto; border-radius: 13px; } .tgt-public-live-top-five > header { padding: 8px 10px; } .tgt-public-live-top-five-list { padding: 3px 8px; } .tgt-public-live-top-five-row { min-height: 34px; } .tgt-public-live-top-five-row > strong { font-size: 12px; } }
        .tgt-public-shell .main-content {
          width: min(1180px, calc(100% - 32px));
          margin-left: auto;
          margin-right: auto;
          padding-left: 0;
          padding-right: 0;
        }
        .tgt-public-shell .leaderboard-card {
          width: 100% !important;
          margin-left: auto !important;
          margin-right: auto !important;
        }
        .tgt-public-shell .section-heading {
          justify-content: center;
          text-align: center;
        }
        .tgt-public-shell .section-heading > div:first-child {
          margin-left: auto;
          margin-right: auto;
        }
        .tgt-public-shell .section-heading .description {
          max-width: 760px;
          margin-left: auto;
          margin-right: auto;
        }
        .tgt-admin-round-card {
          width: min(100%, 980px);
          margin: 0 auto 16px;
          padding: clamp(18px, 3vw, 26px) !important;
          border: 1px solid rgba(25,65,48,.12) !important;
          border-radius: 20px !important;
          background: #ffffff !important;
          box-shadow: 0 12px 32px rgba(18,48,36,.07);
        }
        .tgt-admin-round-fields {
          display: grid !important;
          grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
          gap: 12px !important;
          margin-top: 16px !important;
        }
        .tgt-admin-field {
          min-width: 0;
          padding: 12px;
          border: 1px solid rgba(25,65,48,.10);
          border-radius: 14px;
          background: #f5f7f3;
        }
        .tgt-admin-field-label {
          display: block;
          margin: 0 0 8px;
          color: #557064;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .11em;
          text-transform: uppercase;
        }
        .tgt-admin-field .form-input {
          width: 100%;
          margin: 0 !important;
          background: #ffffff !important;
        }
        .tgt-admin-round-card h3,
        .tgt-admin-round-card > p {
          text-align: center;
        }
        @media (max-width: 760px) {
          .tgt-public-shell .main-content { width: calc(100% - 16px); }
          .tgt-public-shell .section-heading { align-items: center; flex-direction: column; }
          .tgt-admin-round-fields { grid-template-columns: 1fr !important; }
          .tgt-admin-round-card { padding: 15px !important; border-radius: 16px !important; }
        }
        .tgt-season-leaderboard th:nth-child(2),
        .tgt-season-leaderboard td:nth-child(2),
        .tgt-team-leaderboard th:nth-child(2),
        .tgt-team-leaderboard td:nth-child(2) {
          text-align: left !important;
        }
        .tgt-season-leaderboard .player-name,
        .tgt-team-leaderboard .player-name {
          display: block;
          width: 100%;
          text-align: left !important;
        }
        .tgt-team-leaderboard th:first-child,
        .tgt-team-leaderboard td:first-child {
          text-align: center !important;
        }
        .tgt-team-leaderboard th:last-child,
        .tgt-team-leaderboard td:last-child {
          text-align: right !important;
        }
        .tgt-public-shell .section-heading { justify-content: center !important; text-align: center; }
        .tgt-public-shell .section-heading > div:first-child { margin-left: auto; margin-right: auto; }
        .tgt-public-shell .section-heading .description { max-width: 760px; margin-left: auto; margin-right: auto; }
        .tgt-final-flow-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-top:22px; }
        .tgt-final-flow-card { min-height:120px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:18px; border:1px solid rgba(255,255,255,.42); border-radius:18px; background:linear-gradient(145deg,#052a1f,#0a4935); box-shadow:0 12px 28px rgba(3,31,23,.12); text-align:center; }
        .tgt-final-flow-card span { color:#dff0e5; font-size:10px; font-weight:900; letter-spacing:.15em; text-transform:uppercase; }
        .tgt-final-flow-card strong { color:#ffffff; font-size:18px; line-height:1.35; }
        @media(max-width:700px){.tgt-final-flow-grid{grid-template-columns:1fr}.tgt-final-flow-card{min-height:92px}}
        .tgt-public-shell .tgt-tabs {
          justify-content: center !important;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px !important;
          width: 100%;
          margin: 0 auto;
          text-align: center;
        }
        .tgt-public-shell .tgt-tabs button {
          width: auto !important;
          min-width: 118px;
          margin: 0 !important;
        }
        .tgt-public-shell .card-header {
          position: relative;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          align-items: center;
          gap: 18px;
          text-align: center;
        }
        .tgt-public-shell .card-header > div:first-child {
          grid-column: 2;
          width: min(760px, 100%);
          margin: 0 auto;
          text-align: center;
        }
        .tgt-public-shell .card-header > div:first-child .eyebrow,
        .tgt-public-shell .card-header > div:first-child h2,
        .tgt-public-shell .card-header > div:first-child .description {
          text-align: center !important;
          margin-left: auto !important;
          margin-right: auto !important;
        }
        .tgt-public-shell .card-header > :last-child:not(:first-child) {
          grid-column: 3;
          justify-self: end;
        }
        .tgt-season-leaderboard th:nth-child(2),
        .tgt-season-leaderboard td:nth-child(2),
        .tgt-team-leaderboard th:nth-child(2),
        .tgt-team-leaderboard td:nth-child(2) {
          text-align: left !important;
        }
        .tgt-season-leaderboard .player-name,
        .tgt-team-leaderboard .player-name {
          display: block;
          text-align: left !important;
        }
        .tgt-admin-polish {
          width: min(1120px, 100%);
          margin: 0 auto;
        }
        .tgt-admin-polish > section,
        .tgt-admin-polish > article,
        .tgt-admin-polish form > section {
          overflow: hidden;
          border: 1px solid rgba(25,65,48,.12) !important;
          border-radius: 20px !important;
          background: #ffffff !important;
          box-shadow: 0 12px 32px rgba(18,48,36,.07);
        }
        .tgt-admin-polish h2,
        .tgt-admin-polish h3,
        .tgt-admin-polish .eyebrow,
        .tgt-admin-polish .description {
          overflow-wrap: anywhere;
        }
        .tgt-admin-polish nav {
          justify-content: center !important;
          flex-wrap: wrap !important;
          gap: 10px !important;
        }
        .tgt-admin-polish nav button {
          min-width: 132px;
          margin: 0 !important;
        }
        .tgt-admin-polish .flight-information {
          gap: 12px !important;
        }
        .tgt-admin-polish .flight-information > div {
          min-width: 0;
          padding: 16px !important;
        }
        .tgt-admin-polish .flight-information span,
        .tgt-admin-polish .flight-information strong {
          display: block;
          overflow-wrap: anywhere;
        }
        .tgt-admin-polish .flight-information span {
          margin-bottom: 9px;
        }
        .tgt-admin-polish input,
        .tgt-admin-polish select,
        .tgt-admin-polish textarea,
        .tgt-admin-polish .form-input {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }
        @media (max-width: 760px) {
          .tgt-public-shell .tgt-tabs {
            justify-content: center !important;
            overflow: visible !important;
            flex-wrap: wrap !important;
            padding-left: 10px !important;
            padding-right: 10px !important;
          }
          .tgt-public-shell .tgt-tabs button {
            flex: 1 1 calc(50% - 10px) !important;
            min-width: 0;
          }
          .tgt-public-shell .card-header {
            display: flex !important;
            flex-direction: column;
            justify-content: center;
            text-align: center;
          }
          .tgt-public-shell .card-header > :last-child:not(:first-child) {
            align-self: center;
          }
          .tgt-admin-polish nav button {
            flex: 1 1 calc(50% - 10px);
            min-width: 0;
          }
          .tgt-admin-polish .flight-information {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 420px) {
          .tgt-public-shell .tgt-tabs button,
          .tgt-admin-polish nav button {
            flex-basis: 100% !important;
          }
          .tgt-admin-polish .flight-information {
            grid-template-columns: 1fr !important;
          }
        }
        .tgt-wordmark-mark { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid #ffffff; border-radius: 50%; color: #ffffff; font-family: Georgia, serif; font-size: 17px; font-weight: 900; letter-spacing: .04em; text-shadow: 0 1px 14px rgba(255,255,255,.35); }
        .tgt-menu-button { width:46px; height:46px; min-width:46px; padding:0; display:grid; place-items:center; border:1px solid rgba(255,255,255,.22); border-radius:50%; background:transparent; color:#fff; cursor:pointer; }.tgt-menu-icon{position:relative;width:20px;height:14px;display:block}.tgt-menu-icon:before,.tgt-menu-icon:after,.tgt-menu-icon span{content:"";position:absolute;left:0;width:20px;height:2px;border-radius:2px;background:#ffffff}.tgt-menu-icon:before{top:0}.tgt-menu-icon span{top:6px}.tgt-menu-icon:after{top:12px}
        .tgt-premium-hero { position: relative; overflow: hidden; padding: clamp(54px, 9vw, 110px) clamp(20px, 7vw, 92px); color: #fff; background: radial-gradient(circle at 78% 20%, rgba(255,255,255,.24), transparent 28%), linear-gradient(135deg, #062f22 0%, #0b5239 58%, #123a2d 100%); }
        .tgt-premium-hero:after { content: ""; position: absolute; right: -80px; bottom: -170px; width: 480px; height: 480px; border: 1px solid rgba(255,255,255,.1); border-radius: 50%; box-shadow: 0 0 0 55px rgba(255,255,255,.035), 0 0 0 110px rgba(255,255,255,.025); }
        .tgt-hero-inner { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; }
        .tgt-kicker { display: inline-flex; align-items: center; gap: 9px; padding: 7px 11px; border: 1px solid rgba(255,255,255,.45); border-radius: 999px; color: #ffffff; font-size: 12px; font-weight: 800; letter-spacing: .14em; }
        .tgt-premium-hero h1 { max-width: 780px; margin: 22px 0 12px; font-family: Georgia, serif; font-size: clamp(44px, 8vw, 92px); line-height: .95; letter-spacing: -.045em; color: #ffffff; background: linear-gradient(112deg, #168454 0%, #39a86f 24%, #ffffff 48%, #168454 72%, #eaf5ee 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 8px 24px rgba(0,0,0,.22)); }
        .tgt-premium-hero h1 span { display: block; color: #ffffff; -webkit-text-fill-color: #ffffff; background: none; font-size: .43em; letter-spacing: .08em; margin-top: 16px; text-transform: uppercase; }
        .tgt-hero-meta { display: flex; flex-wrap: wrap; gap: 10px 24px; margin-top: 26px; color: rgba(255,255,255,.78); font-weight: 650; }
        .tgt-hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
        .tgt-primary-action, .tgt-secondary-action { min-height: 48px; padding: 0 20px; border-radius: 999px; font-weight: 800; cursor: pointer; }
        .tgt-primary-action { border: 1px solid #ffffff; background: #ffffff; color: #082b20; }
        .tgt-secondary-action { border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.06); color: #fff; }
        .tgt-menu-backdrop { position: fixed; inset: 0; z-index: 45; background: rgba(2,20,14,.58); backdrop-filter: blur(3px); }
        .tgt-drawer { position: fixed; top: 0; right: 0; z-index: 50; width: min(390px, 92vw); height: 100dvh; padding: 22px; background: #f7faf7; color: #10271e; box-shadow: -20px 0 60px rgba(0,0,0,.25); overflow-y: auto; }
        .tgt-drawer-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 18px; border-bottom: 1px solid #d7e6dc; }
        .tgt-drawer-close{width:44px;height:44px;min-width:44px;padding:0;display:grid;place-items:center;border:1px solid #c8ddd0;border-radius:50%;background:#fff;cursor:pointer}.tgt-close-icon{position:relative;width:18px;height:18px;display:block}.tgt-close-icon:before,.tgt-close-icon:after{content:"";position:absolute;top:8px;left:0;width:18px;height:2px;border-radius:2px;background:#173326}.tgt-close-icon:before{transform:rotate(45deg)}.tgt-close-icon:after{transform:rotate(-45deg)}
        .tgt-drawer-nav { display: grid; gap: 8px; margin-top: 20px; }
        .tgt-drawer-nav button { width: 100%; min-height: 52px; padding: 0 15px; text-align: left; border: 1px solid #d7e6dc; border-radius: 12px; background: #fff; color: #173326; font-weight: 750; cursor: pointer; }
        .tgt-public-shell .main-content { margin-top: -28px; position: relative; z-index: 3; }
        .tgt-public-shell .leaderboard-card { border-radius: 22px; overflow: hidden; box-shadow: 0 24px 70px rgba(20,45,34,.14); }
        @media (max-width: 700px) {
          .tgt-public-topbar { padding: 10px 14px; }
          .tgt-wordmark small { display: none; }
          .tgt-premium-hero { padding: 46px 18px 70px; }
          .tgt-premium-hero h1 { font-size: clamp(42px, 16vw, 64px); }
          .tgt-hero-meta { display: grid; gap: 8px; }
          .tgt-hero-actions > button { width: 100%; }
          .tgt-public-shell .main-content { margin-top: -22px; padding-left: 10px; padding-right: 10px; }
          .tgt-public-shell .leaderboard-card { border-radius: 16px; }
          .tgt-public-shell .tgt-tabs { overflow-x: auto; flex-wrap: nowrap; justify-content: flex-start; scrollbar-width: none; }
          .tgt-public-shell .tgt-tabs button { flex: 0 0 auto; min-height: 44px; white-space: nowrap; }
          .tgt-public-shell table { min-width: 680px; }
          .tgt-public-shell .table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
          .tgt-public-shell .leaderboard-card { width: calc(100% - 16px); border-radius: 14px; }
          .tgt-premium-hero { padding: 42px 16px 58px; text-align: center; }
          .tgt-hero-meta { width: 100%; flex-direction: column; align-items: center; gap: 7px; }
          .tgt-hero-actions { width: 100%; flex-direction: column; align-items: stretch; }
          .tgt-hero-actions button { width: 100%; min-height: 48px; }
          .tgt-hof-grid { grid-template-columns: 1fr; gap: 14px; }
          .tgt-hof-card { min-height: 0; padding: 20px 16px; border-radius: 18px; }
          .tgt-hof-trophy { width: 78px; height: 78px; font-size: 40px; }
          .tgt-hof-year { font-size: 50px; }
        }

        /* Final alignment override: center navigation and heading, keep name columns left */
        .tgt-public-shell .tgt-tabs {
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          flex-wrap: wrap !important;
          gap: 10px !important;
          width: 100% !important;
          padding: 12px 16px !important;
          margin: 0 auto !important;
          overflow: visible !important;
          text-align: center !important;
        }
        .tgt-public-shell .tgt-tabs > button {
          flex: 0 0 auto !important;
          width: auto !important;
          min-width: 118px !important;
          margin: 0 !important;
          white-space: normal !important;
        }
        .tgt-public-shell .card-header {
          display: grid !important;
          grid-template-columns: 1fr minmax(280px, 760px) 1fr !important;
          align-items: center !important;
          gap: 18px !important;
          text-align: center !important;
        }
        .tgt-public-shell .card-header > div:first-child {
          grid-column: 2 !important;
          width: 100% !important;
          margin: 0 auto !important;
          text-align: center !important;
        }
        .tgt-public-shell .card-header > div:first-child > * {
          text-align: center !important;
          margin-left: auto !important;
          margin-right: auto !important;
        }
        .tgt-public-shell .card-header > .live-badge {
          grid-column: 3 !important;
          justify-self: end !important;
        }
        .tgt-season-leaderboard th:nth-child(2),
        .tgt-season-leaderboard td:nth-child(2),
        .tgt-team-leaderboard th:nth-child(2),
        .tgt-team-leaderboard td:nth-child(2),
        .tgt-season-leaderboard .player-name,
        .tgt-team-leaderboard .player-name {
          text-align: left !important;
        }

        /* Final admin polish: labels and values never run together */
        .tgt-admin-polish .flight-information {
          display: grid !important;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)) !important;
          gap: 14px !important;
          padding: 16px !important;
          background: #eef5f0 !important;
        }
        .tgt-admin-polish .flight-information > div {
          min-height: 104px !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 14px !important;
          padding: 16px 12px !important;
          border: 1px solid rgba(22,132,84,.44) !important;
          border-radius: 17px !important;
          text-align: center !important;
          background: linear-gradient(145deg,#052a1f,#0a4935) !important;
          box-shadow: 0 10px 24px rgba(3,31,23,.10) !important;
        }
        .tgt-admin-polish .flight-information > div > span {
          display: block !important;
          margin: 0 !important;
          color: #dff0e5 !important;
          font-size: 10px !important;
          font-weight: 900 !important;
          letter-spacing: .13em !important;
          line-height: 1.2 !important;
          text-transform: uppercase !important;
        }
        .tgt-admin-polish .flight-information > div > strong {
          display: block !important;
          margin: 0 !important;
          color: #ffffff !important;
          font-family: Georgia, serif !important;
          font-size: 23px !important;
          line-height: 1.2 !important;
          overflow-wrap: anywhere !important;
        }
        .tgt-admin-polish .tgt-final-flow-grid {
          display: grid !important;
          grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
          gap: 14px !important;
          margin-top: 22px !important;
        }
        .tgt-admin-polish .tgt-final-flow-card {
          min-height: 124px !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 16px !important;
          padding: 18px !important;
          border: 1px solid rgba(22,132,84,.44) !important;
          border-radius: 18px !important;
          text-align: center !important;
          background: linear-gradient(145deg,#052a1f,#0a4935) !important;
        }
        .tgt-admin-polish .tgt-final-flow-card span {
          display: block !important;
          color: #dff0e5 !important;
          font-size: 10px !important;
          font-weight: 900 !important;
          letter-spacing: .14em !important;
          text-transform: uppercase !important;
        }
        .tgt-admin-polish .tgt-final-flow-card strong {
          display: block !important;
          color: #ffffff !important;
          font-size: 18px !important;
          line-height: 1.35 !important;
        }
        @media (max-width: 700px) {
          .tgt-public-shell .tgt-tabs {
            justify-content: center !important;
            flex-wrap: wrap !important;
            overflow: visible !important;
            padding: 10px !important;
          }
          .tgt-public-shell .tgt-tabs > button {
            flex: 1 1 calc(50% - 10px) !important;
            min-width: 0 !important;
          }
          .tgt-public-shell .card-header {
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
          }
          .tgt-public-shell .card-header > .live-badge {
            align-self: center !important;
          }
          .tgt-admin-polish .tgt-final-flow-grid {
            grid-template-columns: 1fr !important;
          }
          .tgt-admin-polish .flight-information {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 420px) {
          .tgt-public-shell .tgt-tabs > button {
            flex-basis: 100% !important;
          }
          .tgt-admin-polish .flight-information {
            grid-template-columns: 1fr !important;
          }
        }


        /* Final clean mobile live layout: no neutral dots and movement stays by the score */
        @media(max-width:700px){
          .tgt-live-mobile-player{grid-template-columns:38px minmax(0,1fr) 76px 38px!important;gap:7px!important;position:relative}
          .tgt-live-mobile-score-wrap{display:flex;align-items:center;justify-content:flex-end;gap:4px;min-width:0}
          .tgt-live-mobile-score-wrap .tgt-position-movement{flex:0 0 auto;min-width:22px;padding:3px 4px;font-size:8px}
          .tgt-live-mobile-name strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .tgt-live-mobile-name small{font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .tgt-public-live-top-five-row{grid-template-columns:28px minmax(0,1fr) 68px 34px!important;gap:6px!important}
          .tgt-public-live-top-five-row>.tgt-score-with-movement{justify-self:end;width:100%}
          .tgt-public-live-top-five-row>.tgt-score-with-movement .tgt-position-movement{min-width:22px;padding:2px 3px;font-size:8px}
          .tgt-marker-top-five-row{grid-template-columns:30px minmax(0,1fr) 66px 36px!important;gap:6px!important}
          .tgt-marker-top-five-row>.tgt-score-with-movement{justify-self:end;width:100%}
          .tgt-marker-top-five-row>.tgt-score-with-movement .tgt-position-movement{min-width:22px;padding:2px 3px;font-size:8px}
          .tgt-position-movement{box-sizing:border-box}
        }
        .tgt-course-database { width:min(1120px,100%); margin:0 auto 24px; padding:clamp(16px,2.5vw,24px); border:1px solid rgba(25,65,48,.12); border-radius:22px; background:#ffffff; box-shadow:0 14px 38px rgba(18,48,36,.08); }
        .tgt-course-db-header { display:flex; align-items:center; justify-content:space-between; gap:20px; text-align:left; }
        .tgt-course-db-header h2,.tgt-course-db-header p { margin-top:4px; }
        .tgt-course-db-count { min-width:110px; padding:15px; display:flex; flex-direction:column; align-items:center; gap:7px; border-radius:16px; color:#ffffff; background:linear-gradient(145deg,#052a1f,#0a4935); }
        .tgt-course-db-count span { color:#dff0e5; font-size:10px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }.tgt-course-db-count strong{font-size:26px}
        .tgt-course-db-layout { display:grid; grid-template-columns:minmax(250px,320px) minmax(0,1fr); gap:18px; margin-top:22px; }
        .tgt-course-db-sidebar,.tgt-course-db-main { min-width:0; }.tgt-course-list{display:grid;gap:8px;max-height:440px;overflow:auto;margin:12px 0 18px;padding-right:4px}
        .tgt-course-list button{display:flex;flex-direction:column;gap:4px;padding:13px;text-align:left;border:1px solid rgba(25,65,48,.12);border-radius:13px;background:#fff;color:#173326;cursor:pointer}.tgt-course-list button.active{color:#ffffff;border-color:#d8b765;background:#073727}.tgt-course-list button span{font-size:12px;opacity:.76}
        .tgt-course-form,.tgt-hole-editor,.tgt-csv-import,.tgt-course-title{padding:18px;border:1px solid rgba(25,65,48,.11);border-radius:17px;background:#f5f7f3}.tgt-course-form{display:grid;gap:10px}.tgt-course-form h3{margin:0}.tgt-tee-form{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:14px}.tgt-tee-form h3,.tgt-tee-form button{grid-column:1/-1}
        .tgt-course-title{text-align:center}.tgt-course-title h3{margin:4px 0}.tgt-tee-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.tgt-tee-grid article{display:flex;flex-direction:column;align-items:center;gap:7px;padding:16px;border:1px solid rgba(22,132,84,.44);border-radius:15px;color:#ffffff;background:linear-gradient(145deg,#052a1f,#0a4935);text-align:center}.tgt-tee-grid article span{color:#dff0e5;font-size:9px;font-weight:900;letter-spacing:.15em}.tgt-tee-grid article strong{font-size:22px}.tgt-tee-grid article small{color:rgba(255,255,255,.74)}
        .tgt-hole-editor{margin-top:14px}.tgt-hole-editor-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.tgt-hole-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:14px 0}.tgt-hole-grid label{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:10px;border-radius:12px;background:#fff;border:1px solid rgba(25,65,48,.11);text-align:center}.tgt-hole-grid label>span{grid-column:1/-1;font-weight:900;color:#174332}.tgt-hole-grid input{width:100%;min-width:0;padding:8px;border:1px solid #d8e0da;border-radius:8px;text-align:center}.tgt-hole-grid small{color:#6a7b73;font-size:9px;text-transform:uppercase}.tgt-csv-import{margin-top:14px;text-align:center}.tgt-csv-import input{display:block;margin:14px auto}.tgt-csv-import button{max-width:320px}
        @media(max-width:820px){.tgt-course-db-layout{grid-template-columns:1fr}.tgt-course-list{max-height:280px}.tgt-hole-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
        @media(max-width:520px){.tgt-course-database{padding:14px}.tgt-course-db-header{align-items:stretch;flex-direction:column;text-align:center}.tgt-course-db-count{width:100%}.tgt-tee-form{grid-template-columns:1fr}.tgt-hole-editor-head{align-items:stretch;flex-direction:column}.tgt-hole-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        /* Unified app experience: desktop and phone share the same hierarchy and controls. */
        .tgt-public-shell{max-width:860px!important;margin:0 auto!important;box-shadow:0 0 70px rgba(3,31,23,.18)!important}
        .tgt-public-topbar{position:sticky!important;top:0!important;z-index:80!important;min-height:64px!important;padding:9px 14px!important}
        .tgt-public-topbar>div:last-child{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:7px!important}
        .tgt-public-login-choice{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:40px!important;padding:0 12px!important;border:1px solid rgba(255,255,255,.52)!important;border-radius:999px!important;color:#ffffff!important;background:rgba(2,27,20,.48)!important;font-size:10px!important;font-weight:900!important;letter-spacing:.06em!important;white-space:nowrap!important}
        .tgt-public-marker-choice{color:#082b20!important;background:linear-gradient(135deg,#eaf5ee,#168454)!important}
        .tgt-desktop-hall-button{display:none!important}
        .tgt-premium-hero{min-height:0!important;padding:46px 18px 68px!important;text-align:center!important}
        .tgt-premium-hero h1{font-size:clamp(42px,8vw,68px)!important}
        .tgt-hero-meta{display:grid!important;gap:7px!important;width:100%!important}
        .tgt-hero-actions{display:grid!important;grid-template-columns:1fr 1fr!important;width:min(560px,100%)!important;gap:10px!important}
        .tgt-hero-actions>button{width:100%!important;margin:0!important}
        .tgt-hero-marker-login{grid-column:1/-1!important}
        .tgt-app-lobby{padding:20px 12px 96px!important}
        .tgt-lobby-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
        .tgt-lobby-grid button{min-height:138px!important;border-radius:18px!important}
        .tgt-public-shell .main-content{width:100%!important;padding-left:8px!important;padding-right:8px!important}
        .tgt-public-shell .leaderboard-card{width:100%!important;border-radius:16px!important}
        .tgt-public-shell .tgt-tabs{justify-content:center!important;flex-wrap:wrap!important;overflow:visible!important}
        .tgt-public-shell .card-header{display:flex!important;flex-direction:column!important;gap:10px!important;text-align:center!important}
        .tgt-public-shell .card-header>div:first-child{width:100%!important;text-align:center!important}
        .tgt-public-shell .card-header>.live-badge{align-self:center!important}
        .tgt-drawer{width:min(390px,92vw)!important}
        @media(max-width:700px){
          .tgt-public-shell{max-width:none!important;box-shadow:none!important}
          .tgt-public-topbar{min-height:58px!important;padding:7px 9px!important}
          .tgt-wordmark{gap:7px!important}.tgt-wordmark-mark{width:38px!important;height:38px!important;font-size:14px!important}
          .tgt-public-login-choice{min-height:36px!important;padding:0 8px!important;font-size:8px!important}
          .tgt-public-marker-choice{display:none!important}
          .tgt-menu-button{width:38px!important;height:38px!important;min-width:38px!important}
          .tgt-premium-hero{padding:35px 14px 50px!important}
          .tgt-premium-hero h1{font-size:clamp(38px,14vw,58px)!important}
          .tgt-hero-actions{grid-template-columns:1fr!important}
          .tgt-hero-marker-login{grid-column:auto!important}
          .tgt-app-lobby{padding:16px 8px 80px!important}
          .tgt-lobby-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
          .tgt-lobby-grid button{min-height:118px!important;padding:13px 8px!important}
        }
        @media(max-width:390px){.tgt-lobby-grid{grid-template-columns:1fr!important}.tgt-lobby-grid button{min-height:96px!important}}
      
        /* Final premium bottom-navigation override */
        .tgt-mit-tgt-universe{padding-bottom:calc(112px + env(safe-area-inset-bottom))!important}
        .tgt-mit-tgt-universe .main-content{padding-bottom:42px!important;scroll-margin-bottom:120px!important}
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav,
        .tgt-player-shell .tgt-mobile-bottom-nav{
          position:fixed!important;left:50%!important;right:auto!important;bottom:max(10px,env(safe-area-inset-bottom))!important;z-index:9999!important;
          width:min(620px,calc(100% - 24px))!important;height:68px!important;min-height:68px!important;
          display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;grid-template-rows:68px!important;align-items:center!important;
          padding:6px 10px!important;margin:0!important;transform:translateX(-50%)!important;
          border:1px solid rgba(255,255,255,.30)!important;border-radius:24px!important;
          background:linear-gradient(180deg,rgba(8,55,40,.96),rgba(3,34,25,.98))!important;
          box-shadow:0 18px 46px rgba(0,24,17,.34),inset 0 1px 0 rgba(255,255,255,.08)!important;
          backdrop-filter:blur(20px) saturate(130%)!important;-webkit-backdrop-filter:blur(20px) saturate(130%)!important;
          overflow:visible!important;box-sizing:border-box!important
        }
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav button,
        .tgt-player-shell .tgt-mobile-bottom-nav button{
          position:relative!important;width:100%!important;height:52px!important;min-width:0!important;min-height:52px!important;
          display:grid!important;place-items:center!important;margin:0!important;padding:0!important;border:0!important;border-radius:17px!important;
          background:transparent!important;color:rgba(255,255,255,.66)!important;box-shadow:none!important;
          transition:background .18s ease,color .18s ease,transform .18s ease!important
        }
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav button:active,
        .tgt-player-shell .tgt-mobile-bottom-nav button:active{transform:scale(.94)!important}
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav button.active,
        .tgt-player-shell .tgt-mobile-bottom-nav button.active{color:#ffffff!important;background:rgba(255,255,255,.10)!important}
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav button.active:after,
        .tgt-player-shell .tgt-mobile-bottom-nav button.active:after{content:""!important;position:absolute!important;left:50%!important;bottom:4px!important;width:4px!important;height:4px!important;transform:translateX(-50%)!important;border-radius:50%!important;background:#ffffff!important;box-shadow:0 0 12px rgba(255,255,255,.75)!important}
        .tgt-mit-tgt-universe .tgt-nav-glyph,.tgt-player-shell .tgt-nav-glyph{width:23px!important;height:23px!important;opacity:.96!important}
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav .tgt-bottom-play,
        .tgt-player-shell .tgt-mobile-bottom-nav .tgt-bottom-play{width:64px!important;min-width:64px!important;max-width:64px!important;height:64px!important;min-height:64px!important;justify-self:center!important;align-self:center!important;margin:-22px auto 0!important;border-radius:50%!important;background:transparent!important}
        .tgt-mit-tgt-universe .tgt-bottom-play-icon,.tgt-player-shell .tgt-bottom-play-icon{width:60px!important;height:60px!important;display:grid!important;place-items:center!important;transform:none!important;border:2px solid rgba(255,255,255,.92)!important;border-radius:50%!important;color:#073326!important;background:linear-gradient(145deg,#ffffff 0%,#39a86f 48%,#08794c 100%)!important;box-shadow:0 12px 28px rgba(0,0,0,.34),0 0 0 5px rgba(5,42,31,.94),inset 0 1px 0 rgba(255,255,255,.55)!important;font-size:11px!important;font-weight:1000!important;letter-spacing:.10em!important}
        .tgt-player-shell{padding-bottom:calc(112px + env(safe-area-inset-bottom))!important}
        .tgt-player-shell .tgt-player-content{padding-bottom:44px!important;scroll-margin-bottom:120px!important}
        @media(max-width:700px){
          .tgt-mit-tgt-universe,.tgt-player-shell{padding-bottom:calc(108px + env(safe-area-inset-bottom))!important}
          .tgt-mit-tgt-universe .tgt-mobile-bottom-nav,.tgt-player-shell .tgt-mobile-bottom-nav{bottom:max(8px,env(safe-area-inset-bottom))!important;width:calc(100% - 20px)!important;border-radius:22px!important}
        }
.tgt-mit-tgt-universe .tgt-public-topbar:after{content:"MIT TGT";position:absolute;left:50%;transform:translateX(-50%);color:#ffffff;font-size:10px;font-weight:900;letter-spacing:.15em}.tgt-mit-tgt-universe .tgt-public-topbar .tgt-public-login-choice{color:#ffffff!important;background:rgba(255,255,255,.09)!important}
        /* Definitive Mit TGT bottom nav. Unique selectors override all legacy nav CSS. */
        .tgt-fixed-bottom-nav{position:fixed!important;left:50%!important;right:auto!important;bottom:max(10px,env(safe-area-inset-bottom))!important;z-index:10000!important;width:min(620px,calc(100% - 20px))!important;height:72px!important;display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;grid-template-rows:72px!important;align-items:center!important;gap:0!important;margin:0!important;padding:7px 10px!important;transform:translateX(-50%)!important;box-sizing:border-box!important;overflow:visible!important;border:1px solid rgba(255,255,255,.34)!important;border-radius:25px!important;background:linear-gradient(180deg,rgba(8,61,43,.98),rgba(3,38,27,.99))!important;box-shadow:0 18px 48px rgba(0,25,18,.38),inset 0 1px 0 rgba(255,255,255,.09)!important;backdrop-filter:blur(20px)!important;-webkit-backdrop-filter:blur(20px)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item{position:relative!important;appearance:none!important;-webkit-appearance:none!important;width:100%!important;height:56px!important;min-width:0!important;min-height:56px!important;max-width:none!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;margin:0!important;padding:0!important;visibility:visible!important;opacity:1!important;overflow:visible!important;border:0!important;border-radius:17px!important;color:rgba(238,250,242,.68)!important;background:transparent!important;box-shadow:none!important;transform:none!important;cursor:pointer!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#ffffff!important;background:rgba(255,255,255,.11)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active:not(.tgt-fixed-nav-play):after{content:""!important;position:absolute!important;left:50%!important;bottom:3px!important;width:4px!important;height:4px!important;transform:translateX(-50%)!important;border-radius:50%!important;background:#ffffff!important;box-shadow:0 0 10px rgba(255,255,255,.8)!important}
        .tgt-fixed-nav-icon{width:23px!important;height:23px!important;display:block!important;visibility:visible!important;opacity:1!important;color:currentColor!important}
        .tgt-fixed-nav-icon svg{width:23px!important;height:23px!important;display:block!important;overflow:visible!important;fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round!important;stroke-linejoin:round!important}
        .tgt-fixed-nav-item small{display:block!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;overflow:visible!important;color:currentColor!important;font-size:8px!important;font-weight:900!important;line-height:1!important;letter-spacing:.05em!important;text-transform:uppercase!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-play{width:64px!important;min-width:64px!important;max-width:64px!important;height:64px!important;min-height:64px!important;justify-self:center!important;align-self:center!important;margin:-25px auto 0!important;border-radius:50%!important;background:transparent!important}
        .tgt-fixed-play-disc{width:60px!important;height:60px!important;display:grid!important;place-items:center!important;visibility:visible!important;opacity:1!important;border:2px solid #ffffff!important;border-radius:50%!important;color:#073326!important;background:linear-gradient(145deg,#eaf5ee 0%,#39a86f 50%,#08794c 100%)!important;box-shadow:0 12px 28px rgba(0,0,0,.36),0 0 0 6px rgba(4,42,31,.98),inset 0 1px 0 rgba(255,255,255,.58)!important;font-size:11px!important;font-weight:1000!important;line-height:1!important;letter-spacing:.10em!important}
        .tgt-fixed-nav-item:active{transform:scale(.94)!important}.tgt-fixed-nav-item:disabled{opacity:.46!important;cursor:not-allowed!important}
        @media(max-width:700px){.tgt-fixed-bottom-nav{bottom:max(8px,env(safe-area-inset-bottom))!important;width:calc(100% - 18px)!important;height:70px!important;grid-template-rows:70px!important;padding:6px 8px!important;border-radius:23px!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item{height:54px!important;min-height:54px!important}.tgt-fixed-nav-item small{font-size:7px!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-play{margin:-23px auto 0!important}}

        /* TGT golf theme: green, black and red. Gold is reserved for Hall of Fame. */
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.12)!important;background:linear-gradient(180deg,rgba(15,20,18,.98),rgba(3,9,7,.99))!important;box-shadow:0 16px 42px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.07)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(234,241,237,.62)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(27,111,70,.30)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active:not(.tgt-fixed-nav-play):after{background:#d8343a!important;box-shadow:0 0 12px rgba(216,52,58,.8)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item:nth-child(4){color:#ef6b70!important}
        .tgt-fixed-play-disc{border-color:#f1f5f2!important;color:#fff!important;background:linear-gradient(145deg,#d9454b,#9f1f25)!important;box-shadow:0 12px 28px rgba(0,0,0,.38),0 0 0 6px rgba(5,24,17,.98),inset 0 1px 0 rgba(255,255,255,.25)!important}
        .tgt-player-appbar{border-bottom-color:rgba(255,255,255,.10)!important;color:#fff!important;background:rgba(5,35,25,.98)!important}
        .tgt-player-brandmark{border-color:rgba(255,255,255,.30)!important;color:#fff!important;background:#07140f!important}
        .tgt-player-brand strong{color:#fff!important}.tgt-player-brand small{color:rgba(226,237,230,.60)!important}
        .tgt-player-menu-button{border-color:rgba(255,255,255,.20)!important;color:#fff!important;background:#07140f!important}
        .tgt-top-menu-svg{width:23px!important;height:23px!important;display:block!important;fill:none!important;stroke:currentColor!important;stroke-width:2!important;stroke-linecap:round!important}
        .tgt-player-head{background:linear-gradient(145deg,#063d2a,#075438)!important;color:#fff!important}
        .tgt-player-head .eyebrow,.tgt-player-head h1,.tgt-player-head span{color:#fff!important}
        .tgt-player-head .tgt-player-actions button{border-color:rgba(255,255,255,.30)!important;color:#fff!important;background:#07140f!important}
        .tgt-player-content{background:#f3f5f3!important}
        .tgt-player-primary{border-color:#0d6843!important;color:#fff!important;background:linear-gradient(135deg,#0b6842,#06442e)!important}
        .tgt-player-kpi,.tgt-player-panel{border-color:#dbe2dd!important;background:#fff!important;box-shadow:0 8px 24px rgba(7,31,22,.07)!important}
        .tgt-player-kpi strong,.tgt-player-panel h2,.tgt-player-panel h3{color:#0a3d2a!important}
        .tgt-player-avatar{color:#fff!important;background:linear-gradient(145deg,#0f754b,#073d2a)!important}
        .tgt-drawer{border-color:rgba(255,255,255,.12)!important;background:#07140f!important;color:#fff!important}
        .tgt-drawer-head{border-bottom-color:rgba(255,255,255,.10)!important}.tgt-drawer-head h2,.tgt-drawer-head .eyebrow{color:#fff!important}
        .tgt-drawer-close{border-color:rgba(255,255,255,.18)!important;color:#fff!important;background:#111a16!important}
        .tgt-drawer-nav button{border-color:rgba(255,255,255,.09)!important;color:#eef4f0!important;background:#0b2419!important}
        .tgt-drawer-nav button:hover{background:#103522!important}
        .tgt-hall-fullscreen,.tgt-hall-panel,.tgt-hall-card{--hall-gold:#d6b25e}

        /* Fresh golf theme: inviting fairway greens with restrained coral-red energy. Hall of Fame keeps its own gold styling. */
        :root{--tgt-forest:#073f2c;--tgt-deep:#052f22;--tgt-fairway:#168454;--tgt-fairway-light:#39a86f;--tgt-mint:#eaf5ee;--tgt-paper:#f7faf7;--tgt-white:#ffffff;--tgt-red:#df454d;--tgt-red-dark:#b92f37;--tgt-ink:#113c2d;--tgt-muted:#688077}
        .tgt-public-shell,.tgt-player-shell{background:linear-gradient(180deg,#dff0e5 0%,#f7faf7 30%,#eef5f0 100%)!important;color:var(--tgt-ink)!important}
        .tgt-public-topbar,.tgt-player-appbar{border-bottom:1px solid rgba(255,255,255,.18)!important;background:linear-gradient(135deg,#075238,#0a6845)!important;color:#fff!important;box-shadow:0 8px 24px rgba(7,63,44,.14)!important}
        .tgt-wordmark-mark,.tgt-player-brandmark{border-color:rgba(255,255,255,.48)!important;color:#fff!important;background:rgba(255,255,255,.10)!important}
        .tgt-wordmark strong,.tgt-player-brand strong{color:#fff!important}.tgt-wordmark small,.tgt-player-brand small{color:rgba(255,255,255,.72)!important}
        .tgt-menu-button,.tgt-player-menu-button{border-color:rgba(255,255,255,.34)!important;color:#fff!important;background:rgba(255,255,255,.12)!important;box-shadow:none!important}
        .tgt-premium-hero,.tgt-player-head{background:linear-gradient(145deg,#086844 0%,#0e8654 62%,#167348 100%)!important;color:#fff!important}
        .tgt-premium-hero:before,.tgt-player-head:before{background:radial-gradient(circle at 82% 20%,rgba(255,255,255,.15),transparent 30%)!important}
        .tgt-premium-hero h1,.tgt-player-head h1,.tgt-premium-hero .eyebrow,.tgt-player-head .eyebrow,.tgt-player-head span{color:#fff!important}
        .tgt-player-content,.main-content,.tgt-app-lobby{background:transparent!important}
        .leaderboard-card,.tgt-player-kpi,.tgt-player-panel,.tgt-lobby-grid button,.tgt-round-card,.tgt-live-card{border-color:#d7e6dc!important;background:rgba(255,255,255,.94)!important;box-shadow:0 10px 28px rgba(7,63,44,.08)!important}
        .leaderboard-card h2,.leaderboard-card h3,.tgt-player-kpi strong,.tgt-player-panel h2,.tgt-player-panel h3,.tgt-lobby-grid strong{color:var(--tgt-ink)!important}
        .eyebrow:not(.tgt-hall-fullscreen .eyebrow):not(.tgt-hall-panel .eyebrow){color:var(--tgt-fairway)!important}
        .tgt-player-avatar{color:#fff!important;background:linear-gradient(145deg,#27a467,#08794c)!important;box-shadow:0 8px 18px rgba(22,132,84,.22)!important}
        .tgt-player-primary,.login-submit-button,.tgt-primary-action{border-color:#0d7b4e!important;color:#fff!important;background:linear-gradient(135deg,#1b985f,#0c7048)!important;box-shadow:0 10px 22px rgba(22,132,84,.20)!important}
        .tgt-player-primary:hover,.login-submit-button:hover,.tgt-primary-action:hover{background:linear-gradient(135deg,#20a768,#0e7b4f)!important}
        .tgt-secondary-action,.login-cancel-button{border-color:#bcd6c5!important;color:#0b6543!important;background:#fff!important}
        .tgt-tabs button.active,.tgt-tab.active,.tgt-filter-button.active{border-color:#168454!important;color:#fff!important;background:#168454!important}
        .live-badge,.tgt-live-badge{border-color:rgba(223,69,77,.28)!important;color:#fff!important;background:var(--tgt-red)!important}
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.22)!important;background:linear-gradient(180deg,rgba(8,91,59,.99),rgba(5,65,45,.99))!important;box-shadow:0 16px 42px rgba(7,63,44,.30),inset 0 1px 0 rgba(255,255,255,.14)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(238,250,242,.72)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(255,255,255,.14)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active:not(.tgt-fixed-nav-play):after{background:var(--tgt-red)!important;box-shadow:0 0 12px rgba(223,69,77,.75)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item:nth-child(4){color:#ffd9db!important}
        .tgt-fixed-play-disc{border-color:#fff!important;color:#fff!important;background:linear-gradient(145deg,#ef5a61,#c9323a)!important;box-shadow:0 12px 27px rgba(95,22,27,.28),0 0 0 6px rgba(7,86,56,.98),inset 0 1px 0 rgba(255,255,255,.30)!important}
        .tgt-drawer{border-color:rgba(255,255,255,.18)!important;background:linear-gradient(160deg,#07543a,#0b7049)!important;color:#fff!important}
        .tgt-drawer-head{border-bottom-color:rgba(255,255,255,.15)!important}.tgt-drawer-head h2,.tgt-drawer-head .eyebrow{color:#fff!important}
        .tgt-drawer-close{border-color:rgba(255,255,255,.28)!important;color:#fff!important;background:rgba(255,255,255,.12)!important}
        .tgt-drawer-nav button{border-color:rgba(255,255,255,.12)!important;color:#fff!important;background:rgba(255,255,255,.09)!important}
        .tgt-drawer-nav button:hover{background:rgba(255,255,255,.16)!important}
        .status-box{border-color:#d3e6da!important;color:#45685a!important;background:#eff7f2!important}
        .tgt-player-stat{background:#eff7f2!important}.tgt-player-stat strong{color:#08764a!important}
        .tgt-hall-fullscreen,.tgt-hall-panel,.tgt-hall-card{--hall-gold:#d6b25e}

        @media(max-width:700px){
          .tgt-mit-tgt-universe .tgt-public-topbar{min-height:64px!important;padding:8px 10px!important}
          .tgt-mit-tgt-universe .tgt-wordmark>span:last-child{display:none!important}
          .tgt-mit-tgt-universe .tgt-wordmark-mark{width:42px!important;height:42px!important;min-width:42px!important}
          .tgt-mit-tgt-universe .tgt-public-topbar:after{font-size:9px!important;letter-spacing:.12em!important}
          .tgt-mit-tgt-universe .tgt-public-login-choice{min-height:38px!important;padding:0 10px!important;font-size:8px!important}
          .tgt-mit-tgt-universe .tgt-menu-button{width:40px!important;height:40px!important;min-width:40px!important}
          .tgt-mit-tgt-universe .tgt-tabs{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;padding:10px!important}
          .tgt-mit-tgt-universe .tgt-tabs button{min-width:0!important;width:100%!important;font-size:15px!important;padding:12px 8px!important;white-space:normal!important;line-height:1.1!important}
        }

/* Final anti-gold pass outside Hall of Fame */
.tgt-public-topbar,.tgt-player-appbar,.tgt-mit-tgt-universe{--tgt-gold-replacement:#ffffff}
.tgt-public-topbar *, .tgt-player-appbar *, .tgt-mit-tgt-universe .eyebrow, .tgt-mit-tgt-universe h1, .tgt-mit-tgt-universe h2, .tgt-mit-tgt-universe h3 {color:inherit}
.tgt-mit-tgt-universe .tgt-wordmark, .tgt-mit-tgt-universe .tgt-public-login-choice, .tgt-mit-tgt-universe .tgt-score-label, .tgt-mit-tgt-universe .position-1, .tgt-mit-tgt-universe .position-2, .tgt-mit-tgt-universe .position-3 {color:#113c2d!important}
.tgt-mit-tgt-universe .position-badge{background:#eaf5ee!important;color:#0b6543!important}
.tgt-mit-tgt-universe .position-1,.tgt-mit-tgt-universe .position-2,.tgt-mit-tgt-universe .position-3{background:#eaf5ee!important}

        /* FINAL AUTHENTICATED UI: no burger, no gold, fixed nav, full scroll room */
        .tgt-mit-tgt-universe,.tgt-player-shell,.tgt-menu-page{padding-bottom:calc(132px + env(safe-area-inset-bottom))!important}
        .tgt-mit-tgt-universe .main-content,.tgt-player-shell .tgt-player-content,.tgt-menu-page-shell{padding-bottom:64px!important;scroll-margin-bottom:140px!important}
        .tgt-mit-tgt-universe .tgt-public-login-choice,.tgt-mit-tgt-universe .tgt-menu-button,.tgt-player-menu-button{display:none!important}
        .tgt-mit-tgt-universe .tgt-public-topbar{justify-content:flex-start!important;background:linear-gradient(135deg,#075238,#0a6845)!important}
        .tgt-mit-tgt-universe .tgt-public-topbar:after{content:"MIT TGT"!important;left:auto!important;right:16px!important;transform:none!important;color:#fff!important;font:900 10px/1 system-ui,sans-serif!important;letter-spacing:.16em!important}
        .tgt-mit-tgt-universe .tgt-wordmark,.tgt-mit-tgt-universe .tgt-wordmark *,.tgt-player-appbar,.tgt-player-appbar *{color:#fff!important}
        .tgt-mit-tgt-universe .tgt-wordmark-mark,.tgt-player-brandmark{border-color:rgba(255,255,255,.46)!important;color:#fff!important;background:rgba(255,255,255,.10)!important}
        .tgt-mit-tgt-universe .eyebrow:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-player-shell .eyebrow{color:#168454!important}
        .tgt-mit-tgt-universe h1:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-mit-tgt-universe h2:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-mit-tgt-universe h3:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-player-shell h1,.tgt-player-shell h2,.tgt-player-shell h3{color:#113c2d!important}
        .tgt-player-head h1,.tgt-player-head h2,.tgt-player-head h3,.tgt-player-head p,.tgt-player-head span,.tgt-player-head .eyebrow,.tgt-menu-page-head h1,.tgt-menu-page-head p,.tgt-menu-page-head span{color:#fff!important}
        .tgt-mit-tgt-universe th,.tgt-mit-tgt-universe td,.tgt-mit-tgt-universe .player-name,.tgt-mit-tgt-universe .score,.tgt-mit-tgt-universe .score-value,.tgt-player-shell .player-name{color:#113c2d!important}
        .tgt-mit-tgt-universe .waiting,.tgt-mit-tgt-universe .pending,.tgt-mit-tgt-universe [class*="await"]{color:#688077!important}
        .tgt-mit-tgt-universe .tgt-tabs button,.tgt-mit-tgt-universe .tgt-tab,.tgt-mit-tgt-universe .tgt-filter-button{color:#0b6543!important;background:#fff!important;border-color:#c8ddd0!important}
        .tgt-mit-tgt-universe .tgt-tabs button.active,.tgt-mit-tgt-universe .tgt-tab.active,.tgt-mit-tgt-universe .tgt-filter-button.active{color:#fff!important;background:#168454!important;border-color:#168454!important}
        .tgt-mit-tgt-universe .live-badge,.tgt-mit-tgt-universe .tgt-live-badge{color:#fff!important;background:#df454d!important;border-color:#df454d!important}
        /* Classic podium palette remains visible */
        .tgt-mit-tgt-universe .position-badge.position-1,.tgt-mit-tgt-universe .position-1{color:#0b6543!important;background:#eaf5ee!important;border-color:#bcd6c5!important}
        .tgt-mit-tgt-universe .position-badge.position-2,.tgt-mit-tgt-universe .position-2{color:#33424b!important;background:#d9e0e4!important;border-color:#c4ced3!important}
        .tgt-mit-tgt-universe .position-badge.position-3,.tgt-mit-tgt-universe .position-3{color:#5c3214!important;background:#dca56f!important;border-color:#c98e54!important}
        .tgt-fixed-bottom-nav{bottom:max(10px,env(safe-area-inset-bottom))!important}
        @media(max-width:700px){
          .tgt-mit-tgt-universe,.tgt-player-shell,.tgt-menu-page{padding-bottom:calc(128px + env(safe-area-inset-bottom))!important}
          .tgt-mit-tgt-universe .main-content,.tgt-player-shell .tgt-player-content,.tgt-menu-page-shell{padding-bottom:68px!important}
          .tgt-mit-tgt-universe .tgt-public-topbar:after{right:12px!important}
          .tgt-fixed-bottom-nav{bottom:max(8px,env(safe-area-inset-bottom))!important}
        }

        /* Mobile header breathing room while preserving EST. 2023 */
        @media(max-width:700px){
          .tgt-mit-tgt-universe .tgt-public-topbar{
            min-height:88px!important;
            height:auto!important;
            padding:12px 14px!important;
            align-items:center!important;
            overflow:visible!important;
            box-sizing:border-box!important;
          }
          .tgt-mit-tgt-universe .tgt-wordmark{
            display:grid!important;
            grid-template-columns:48px minmax(0,1fr)!important;
            align-items:center!important;
            gap:12px!important;
            width:calc(100% - 72px)!important;
            min-width:0!important;
          }
          .tgt-mit-tgt-universe .tgt-wordmark-mark{
            width:46px!important;
            height:46px!important;
            min-width:46px!important;
          }
          .tgt-mit-tgt-universe .tgt-wordmark>span:last-child{
            display:block!important;
            min-width:0!important;
            color:#fff!important;
            font-size:clamp(13px,4vw,18px)!important;
            line-height:1.12!important;
            letter-spacing:.10em!important;
            white-space:normal!important;
            overflow:visible!important;
          }
          .tgt-mit-tgt-universe .tgt-wordmark small{
            display:block!important;
            margin-top:6px!important;
            color:rgba(255,255,255,.72)!important;
            font-size:9px!important;
            line-height:1!important;
            letter-spacing:.16em!important;
          }
          .tgt-mit-tgt-universe .tgt-public-topbar:after{
            right:14px!important;
            top:50%!important;
            transform:translateY(-50%)!important;
            color:#fff!important;
          }
          .tgt-mit-tgt-universe .tgt-tabs{
            margin-top:12px!important;
          }
        }
        @media(max-width:430px){
          .tgt-mit-tgt-universe .tgt-public-topbar{min-height:92px!important;padding:12px 10px!important}
          .tgt-mit-tgt-universe .tgt-wordmark{grid-template-columns:44px minmax(0,1fr)!important;gap:9px!important;width:calc(100% - 64px)!important}
          .tgt-mit-tgt-universe .tgt-wordmark-mark{width:42px!important;height:42px!important;min-width:42px!important}
          .tgt-mit-tgt-universe .tgt-wordmark>span:last-child{font-size:13px!important;letter-spacing:.07em!important}
          .tgt-mit-tgt-universe .tgt-wordmark small{font-size:8px!important;margin-top:5px!important}
          .tgt-mit-tgt-universe .tgt-public-topbar:after{right:10px!important;font-size:8px!important;letter-spacing:.10em!important}
        }

        /* Final release logo and compact-copy pass */
        .tgt-wordmark-mark,.tgt-player-brandmark{border-color:rgba(255,255,255,.58)!important;color:#fff!important;background:#0b7049!important;text-shadow:none!important}
        .tgt-wordmark,.tgt-wordmark>span,.tgt-wordmark small,.tgt-player-brand,.tgt-player-brand strong,.tgt-player-brand small{color:#fff!important;text-shadow:none!important}
        .tgt-public-topbar .tgt-wordmark>span:last-child{color:#fff!important}
        .tgt-public-topbar .tgt-wordmark small{color:rgba(255,255,255,.72)!important}
        .tgt-mit-tgt-universe .leaderboard-card>.card-header .description{display:none!important}

        /* Final header spacing before release */
        .tgt-mit-tgt-universe .tgt-public-topbar{border-bottom:0!important}
        .tgt-mit-tgt-universe .tgt-tabs{margin-top:16px!important;padding-top:6px!important;padding-left:14px!important;padding-right:14px!important}
        .tgt-mit-tgt-universe .tgt-tabs + .tgt-tabs,.tgt-mit-tgt-universe .tgt-tabs + [class*="tabs"]{margin-top:10px!important}
        .tgt-mit-tgt-universe .tgt-public-topbar:after{font-size:11px!important;letter-spacing:.17em!important}
        @media(max-width:700px){
          .tgt-mit-tgt-universe .tgt-tabs{margin-top:14px!important;padding-top:5px!important;padding-left:10px!important;padding-right:10px!important}
          .tgt-mit-tgt-universe .tgt-tabs + .tgt-tabs,.tgt-mit-tgt-universe .tgt-tabs + [class*="tabs"]{margin-top:9px!important}
          .tgt-mit-tgt-universe .tgt-public-topbar:after{font-size:9px!important}
        }

        /* Hall of Fame is the only gold universe */
        .tgt-hof-card{border-color:rgba(240,207,130,.58)!important;color:#f3d98f!important;background:radial-gradient(circle at 50% 0%,rgba(255,231,160,.18),transparent 26%),radial-gradient(circle at 110% 90%,rgba(199,154,66,.18),transparent 36%),linear-gradient(150deg,#031f17 0%,#073c2b 55%,#0a5039 100%)!important;box-shadow:0 24px 65px rgba(3,31,23,.24),inset 0 1px 0 rgba(255,241,184,.12)!important}
        .tgt-hof-card:before{background:linear-gradient(115deg,transparent 20%,rgba(255,238,169,.08) 43%,transparent 62%)!important}
        .tgt-hof-trophy{border-color:rgba(255,230,151,.76)!important;background:radial-gradient(circle at 32% 22%,#fff0ae 0%,#d9ad51 42%,#9d691d 100%)!important;box-shadow:0 14px 36px rgba(211,165,73,.32),0 0 0 8px rgba(240,207,130,.06)!important}
        .tgt-hof-year{background:linear-gradient(112deg,#a97724 0%,#d7b159 25%,#fff0ad 50%,#d5a94d 75%,#f1d484 100%)!important;-webkit-background-clip:text!important;background-clip:text!important;-webkit-text-fill-color:transparent!important}
        .tgt-hof-kicker{color:#c9aa60!important}.tgt-hof-winner{border-color:rgba(240,207,130,.28)!important}.tgt-hof-winner span{color:#c6a75d!important}.tgt-hof-winner strong{color:#f7df99!important}.tgt-hof-course{border-top-color:rgba(240,207,130,.22)!important;color:rgba(247,223,153,.72)!important}

        /* Release rule: menu-driven navigation and zero gold outside Hall of Fame */
        .tgt-individual-back-button,.tgt-team-back-button,.tgt-live-back-button,.tgt-panel-back-button{display:none!important}
        .tgt-player-shell,.tgt-public-shell,.tgt-menu-page,.tgt-ops-shell{--tgt-accent:#168454;--tgt-accent-light:#eaf5ee;--tgt-ink:#113c2d}
        .tgt-player-shell .eyebrow,.tgt-ops-shell .eyebrow,.tgt-menu-page .eyebrow{color:#168454!important}
        .tgt-player-head .eyebrow,.tgt-player-head h1,.tgt-player-head span,.tgt-marker-live-header,.marker-header h1,.marker-header .eyebrow{color:#fff!important}
        .tgt-player-avatar,.tgt-team-avatar{color:#fff!important;background:linear-gradient(145deg,#27a467,#08794c)!important;border-color:#fff!important;box-shadow:none!important}
        .tgt-player-kpi,.tgt-player-panel,.tgt-player-stat,.tgt-team-profile,.tgt-team-round,.tgt-team-final-kpi,.tgt-profile-directory-card,.tgt-directory-stat,.tgt-final-flow-card,.tgt-marker-kpi,.tgt-course-db-count,.tgt-tee-grid article{border-color:#d7e6dc!important;color:#113c2d!important;background:#fff!important;box-shadow:0 8px 22px rgba(7,63,44,.07)!important}
        .tgt-player-kpi span,.tgt-player-stat small,.tgt-team-round span,.tgt-directory-stat small,.tgt-final-flow-card span,.tgt-marker-kpi span,.tgt-course-db-count span,.tgt-tee-grid article span,.tgt-tee-grid article small{color:#688077!important}
        .tgt-player-kpi strong,.tgt-player-stat strong,.tgt-team-round strong,.tgt-team-final-kpi strong,.tgt-directory-stat strong,.tgt-final-flow-card strong,.tgt-marker-kpi strong,.tgt-course-db-count strong,.tgt-tee-grid article strong{color:#0b6543!important}
        .tgt-player-result strong,.final-score,.tgt-public-live-top-five-row>span:nth-last-child(2),.tgt-marker-top-five-row>span:nth-last-child(2){color:#0b6543!important}
        .tgt-ops-shell>.marker-card,.tgt-player-home{border-color:rgba(255,255,255,.22)!important}
        .tgt-ops-shell .marker-header,.tgt-marker-live-header,.tgt-marker-top-five-card>header,.tgt-marker-live-table thead{border-color:rgba(255,255,255,.16)!important;color:#fff!important;background:linear-gradient(135deg,#075238,#0a6845)!important}
        .tgt-ops-shell .logout-button,.tgt-marker-live-back,.tgt-marker-live-refresh{border-color:rgba(255,255,255,.34)!important;color:#fff!important;background:rgba(255,255,255,.12)!important}
        .tgt-marker-live-toggle button.active,.tgt-course-list button.active{border-color:#168454!important;color:#fff!important;background:#168454!important}
        .tgt-marker-live-table th{color:#fff!important;border-bottom-color:rgba(255,255,255,.18)!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1,.tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1 span{color:#fff!important;background:none!important;-webkit-text-fill-color:#fff!important;filter:none!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-kicker{border-color:rgba(255,255,255,.38)!important;color:#fff!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-primary-action{border-color:#fff!important;color:#fff!important;background:#168454!important}
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.20)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(238,250,242,.72)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(255,255,255,.14)!important}.tgt-fixed-play-disc{border-color:#fff!important;color:#fff!important;background:linear-gradient(145deg,#ef5a61,#c9323a)!important}
`}</style>

      <header className="tgt-public-topbar">
        <div className="tgt-wordmark">
          <span className="tgt-wordmark-mark">TGT</span>
          <span>
            THE GOLDEN TEE TOUR
            <small style={{ display: "block", opacity: .62, fontSize: 9, marginTop: 2 }}>
              EST. 2023
            </small>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!isAuthenticated && <button
            type="button"
            className="tgt-mobile-marker-login tgt-public-login-choice"
            onClick={()=>onOpenPlayerLogin?.()}
          >
            MIT TGT
          </button>}
          <button
            type="button"
            className="tgt-desktop-hall-button"
            onClick={() => openPanelFullscreen("hall")}
            style={{
              minHeight: 44,
              padding: "0 16px",
              border: "1px solid #ffffff",
              borderRadius: 999,
              background: "linear-gradient(135deg, #eaf5ee, #168454)",
              color: "#173326",
              fontWeight: 900,
              letterSpacing: ".08em",
              cursor: "pointer",
            }}
          >
            HALL OF FAME
          </button>
        {!isAuthenticated && <button
          type="button"
          className="tgt-menu-button"
          aria-label="Åbn hovedmenu"
          aria-expanded={menuOpen}
          aria-controls="tgt-main-menu"
          onClick={() => setMenuOpen(true)}
        >
          ☰
        </button>}
        </div>
      </header>

      {!isAuthenticated && menuOpen && (
        <>
          <div className="tgt-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <aside id="tgt-main-menu" className="tgt-drawer" aria-label="Hovedmenu" aria-modal="true" role="dialog">
            <div className="tgt-drawer-header">
              <div>
                <p className="eyebrow">The Golden Tee Tour</p>
                <strong style={{ fontSize: 22 }}>Menu</strong>
              </div>
              <button
                type="button"
                className="tgt-drawer-close"
                aria-label="Luk hovedmenu"
                onClick={() => setMenuOpen(false)}
              >
                ×
              </button>
            </div>
            <nav className="tgt-drawer-nav">
              {isAuthenticated ? <>
                <button type="button" onClick={()=>{setMenuOpen(false);onPortalNavigate?.("profile")}}>Min profil</button>
                <button type="button" onClick={()=>{setMenuOpen(false);onPortalNavigate?.("leaderboard")}}>Leaderboard og live-leaderboard</button>
                <button type="button" onClick={()=>{setMenuOpen(false);onPortalNavigate?.("live-leaderboard")}}>Livescore og live-leaderboard</button>
                <button type="button" onClick={()=>{setMenuOpen(false);onPortalNavigate?.("play")}}>Scoreindtastning</button>
                <button type="button" onClick={()=>openPanelFullscreen("rounds")}>Runder</button>
                <button type="button" onClick={()=>openPanelFullscreen("profiles")}>Spillerprofiler</button>
                <button type="button" onClick={()=>openPanelFullscreen("hall")}>Hall of Fame</button>
              </> : <>
                <button type="button" onClick={openIndividualFullscreen}>Leaderboard</button>
                <button type="button" onClick={()=>openPanelFullscreen("rounds")}>Runder</button>
                <button type="button" onClick={()=>openPanelFullscreen("profiles")}>Spillerprofiler</button>
                <button type="button" onClick={()=>openLiveFullscreen("individual")}>Live leaderboard</button>
                <button type="button" onClick={openTeamFullscreen}>Holdturneringen</button>
                <button type="button" onClick={()=>openPanelFullscreen("hall")}>Hall of Fame</button>
                <button type="button" className="tgt-menu-marker-login" onClick={()=>{setMenuOpen(false);onOpenPlayerLogin?.()}}>Mit TGT-login</button>
              </>}
            </nav>
          </aside>
        </>
      )}

      {!isAuthenticated && <section className="tgt-premium-hero">
        <div className="tgt-hero-inner">
          <span className="tgt-kicker">SÆSON {selectedSeason} · THE GOLDEN TEE TOUR</span>
          <h1>
            The Golden Tee Tour
            <span>{selectedSeason} Leaderboard</span>
          </h1>
          <div className="tgt-hero-meta">
            <span>Den officielle sæsonstilling</span>
            <span>Sæsonens officielle leaderboard</span>
            <span>15 spillere · 7 hold</span>
          </div>
          <div className="tgt-hero-actions">
            <button
              type="button"
              className="tgt-primary-action"
              onClick={() => openLiveFullscreen("individual")}
            >
              Følg live
            </button>
            <button
              type="button"
              className="tgt-secondary-action"
              onClick={openIndividualFullscreen}
            >
              Se stillingen
            </button>
            <button
              type="button"
              className="tgt-secondary-action tgt-hero-marker-login"
              onClick={onOpenPlayerLogin}
            >
              Mit TGT-login
            </button>
          </div>
        </div>
      </section>}

      {!isAuthenticated && !individualFullscreen && !teamFullscreen && !liveFullscreen && !panelFullscreen && (
        <section className="tgt-app-lobby" aria-label="TGT hovedmenu">
          <div className="tgt-lobby-heading">
            <p className="eyebrow">TGT Live</p>
            <h2>Vælg hvor du vil hen</h2>
            <p>Leaderboard, livescore, runder og historik åbner som selvstændige app-visninger.</p>
          </div>
          <div className="tgt-lobby-grid">
            <button type="button" onClick={openIndividualFullscreen}><span>◆</span><strong>Individuel</strong><small>Sæsonens leaderboard</small></button>
            <button type="button" onClick={openTeamFullscreen}><span>◇</span><strong>Hold</strong><small>Holdleaderboard</small></button>
            <button type="button" onClick={() => openLiveFullscreen("individual")}><span>●</span><strong>Live score</strong><small>Individuel og hold</small></button>
            <button type="button" onClick={() => openPanelFullscreen("rounds")}><span>▦</span><strong>Runder</strong><small>Overblik, live og konkurrencer</small></button>
            <button type="button" onClick={() => openPanelFullscreen("profiles")}><span>◎</span><strong>Spillere</strong><small>Profiler og statistik</small></button>
            <button type="button" onClick={() => openPanelFullscreen("hall")} className="tgt-lobby-hall"><span>🏆</span><strong>Hall of Fame</strong><small>TGT-mestrene</small></button>
          </div>
        </section>
      )}
      <main className={`main-content${individualFullscreen ? " tgt-individual-fullscreen" : ""}${teamFullscreen ? " tgt-team-fullscreen" : ""}${liveFullscreen ? " tgt-live-fullscreen" : ""}${panelFullscreen ? " tgt-panel-fullscreen" : ""}`}>
        {individualFullscreen && !isAuthenticated && (
          <header className="tgt-individual-fullscreen-header">
            <button
              type="button"
              className="tgt-individual-back-button"
              onClick={closeIndividualFullscreen}
              aria-label="Tilbage til start"
            >
              <span aria-hidden="true">‹</span>
              Tilbage
            </button>
            <strong>Individuelt leaderboard</strong>
            <span className="tgt-individual-header-balance" aria-hidden="true" />
          </header>
        )}
        {teamFullscreen && !isAuthenticated && (
          <header className="tgt-team-fullscreen-header">
            <button type="button" className="tgt-team-back-button" onClick={closeTeamFullscreen} aria-label="Tilbage til start">
              <span aria-hidden="true">‹</span>
              Tilbage
            </button>
            <strong>Holdleaderboard</strong>
            <span className="tgt-team-header-balance" aria-hidden="true" />
          </header>
        )}
        {liveFullscreen && !isAuthenticated && (
          <header className="tgt-live-fullscreen-header">
            <div className="tgt-live-fullscreen-topline">
              <button type="button" className="tgt-live-back-button" onClick={closeLiveFullscreen} aria-label="Tilbage til start">
                <span aria-hidden="true">‹</span>
                Tilbage
              </button>
              <strong>Live score</strong>
              <span className="tgt-live-header-balance" aria-hidden="true" />
            </div>
            <nav className="tgt-live-view-toggle" aria-label="Vælg livestilling">
              <button type="button" className={liveView === "individual" ? "active" : ""} onClick={() => setLiveView("individual")}>Individuel</button>
              <button type="button" className={liveView === "team" ? "active" : ""} onClick={() => setLiveView("team")}>Hold</button>
            </nav>
          </header>
        )}
        {panelFullscreen && !isAuthenticated && (
          <header className="tgt-panel-fullscreen-header">
            <button type="button" className="tgt-panel-back-button" onClick={closePanelFullscreen} aria-label="Tilbage til start">
              <span aria-hidden="true">‹</span> Tilbage
            </button>
            <strong>{headings[panelFullscreen]?.title ?? "TGT Live"}</strong>
            <span className="tgt-panel-header-balance" aria-hidden="true" />
          </header>
        )}
        <section className="leaderboard-card">
          <nav
            aria-label="Hovednavigation"
            style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, width: "100%", padding: 10, margin: "0 auto", background: "#082f23" }}
          >
            <button type="button" onClick={() => { setMainTab("individual"); setTab("season"); }} className={tab !== "rounds" ? "login-submit-button" : "login-cancel-button"} style={{ marginTop: 0 }}>LEADERBOARD</button>
            <button type="button" onClick={() => setTab("rounds")} className={tab === "rounds" ? "login-submit-button" : "login-cancel-button"} style={{ marginTop: 0 }}>RUNDER</button>
          </nav>

          {tab !== "rounds" && tab !== "hall" && (
          <nav
            aria-label="Leaderboard kategori"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              padding: 10,
              background: "#eaf1ec",
              borderBottom: "1px solid #d8e4db",
            }}
          >
            <button
              type="button"
              onClick={openIndividualFullscreen}
              className={
                mainTab === "individual"
                  ? "login-submit-button"
                  : "login-cancel-button"
              }
              style={{ marginTop: 0, fontSize: 17 }}
            >
              Individuel
            </button>
            <button
              type="button"
              onClick={openTeamFullscreen}
              className={
                mainTab === "team"
                  ? "login-submit-button"
                  : "login-cancel-button"
              }
              style={{ marginTop: 0, fontSize: 17 }}
            >
              Hold
            </button>
          </nav>
          )}

          {!mainTab && (
            <div
              style={{
                padding: "18px 20px",
                textAlign: "center",
                color: "#617067",
                background: "#f8faf8",
                borderBottom: "1px solid #e2e9e4",
                fontWeight: 700,
              }}
            >
              Vælg Individuel eller Hold for at åbne turneringsoversigten
            </div>
          )}

          {mainTab && !individualFullscreen && !teamFullscreen && !liveFullscreen && !panelFullscreen && (
          <div
            className="tgt-tabs"
            style={{
              paddingTop: 12,
              paddingBottom: 12,
              background: "#f8faf8",
              borderBottom: "1px solid #e2e9e4",
            }}
          >
            {mainTab === "individual" ? (
              <>
                {[
                  ["season", "Overblik"],
                  ["live", liveData?.round ? `Runde ${liveData.round.round_number}` : "Live runde"],
                  ["final", "Samlet finalestilling"],
                  ["closest", "Tættest på pinden"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setTab(value)}
                    className={
                      tab === value
                        ? "login-submit-button"
                        : "login-cancel-button"
                    }
                    style={{ width: "auto", marginTop: 0 }}
                  >
                    {label}
                  </button>
                ))}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setTab("team")}
                className="login-submit-button"
                style={{ width: "auto", marginTop: 0 }}
              >
                Overblik
              </button>
            )}
          </div>
          )}

          <div className="card-header">
            <div>
              <p className="eyebrow">{currentHeading.eyebrow}</p>
              <h2>{currentHeading.title}</h2>

            </div>
            <div className="live-badge">
              <span className="live-dot" /> {liveLeaderboardMode === "both"
                ? "INDIVIDUEL + HOLD LIVE"
                : liveLeaderboardMode === "individual"
                  ? "INDIVIDUEL LIVE"
                  : liveLeaderboardMode === "team"
                    ? "HOLD LIVE"
                    : "LIVE"}
            </div>
          </div>

          {loading && <div className="status-box">Henter TGT-data...</div>}

          {!loading && errorMessage && (
            <div className="error-box">
              <strong>Data kunne ikke hentes</strong>
              <span>{errorMessage}</span>
            </div>
          )}

          {!loading && !errorMessage && tab === "profiles" && (
            <div style={{ padding: 20 }}>
              <input
                type="search"
                value={profileSearch}
                onChange={(event) => setProfileSearch(event.target.value)}
                placeholder="Søg efter spiller..."
                style={{ width: "100%", padding: "15px 18px", borderRadius: 999, border: "1px solid rgba(169,117,37,.35)", marginBottom: 20, fontSize: 16, background: "#ffffff", color: "#123b2c", boxShadow: "0 8px 24px rgba(24,56,43,.07)" }}
              />
              <div className="tgt-profile-directory">
                {standings
                  .filter((player) => player.player_name.toLowerCase().includes(profileSearch.trim().toLowerCase()))
                  .sort((a, b) => a.player_name.localeCompare(b.player_name, "da"))
                  .map((player) => {
                    const isOpen = directoryPlayerId === player.player_id;
                    const rounds = seasonRoundHistory[player.player_id] ?? [];
                    const position = standings.findIndex((entry) => entry.player_id === player.player_id) + 1;
                    return (
                      <article key={player.player_id} className="tgt-profile-directory-card" style={{ color: "#ffffff" }}>
                        <button type="button" onClick={() => setDirectoryPlayerId(isOpen ? null : player.player_id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: 0, border: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}>
                          <span style={{ width: 58, height: 58, minWidth: 58, display: "grid", placeItems: "center", borderRadius: "50%", background: "linear-gradient(135deg, #39a86f, #08794c)", color: "#123629", fontWeight: 900, fontSize: 20 }}>{getInitials(player.player_name)}</span>
                          <span><strong style={{ display: "block", fontSize: 17 }}>{player.player_name}</strong><small>{selectedSeason} · Placering {position}</small></span>
                        </button>
                        {isOpen && (
                          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.25)" }}>
                            <div className="tgt-directory-stats">
                              {[
                                ["HCP", playerDirectory[player.player_id]?.handicap_index ?? "–"],
                                ["Placering", position],
                                ["Score", formatScore(player.counting_score)],
                                ["Bedste", rounds.length ? formatScore(Math.min(...rounds.map((round) => round.scoreToPar))) : "–"],
                                ["Runder", player.rounds_played ?? rounds.length],
                                ["Damebajere", damebajerCounts[player.player_id] ?? 0],
                              ].map(([label, value]) => (
                                <div key={label} className="tgt-directory-stat">
                                  <strong>{value}</strong>
                                  <small>{label}</small>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
              </div>
            </div>
          )}

          {!loading && !errorMessage && tab === "rounds" && (
            <div style={{ padding: 20, display: "grid", gap: 14 }}>
              {publicRounds.length === 0 ? (
                <div className="status-box" style={{ margin: 0 }}>Ingen publicerede runder endnu.</div>
              ) : publicRounds.map((round) => {
                const statusLabel = round.status === "live" ? "Følg live" : round.status === "ready" ? "Se startliste" : "Se resultat";
                return (
                  <article key={round.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", padding: 18, border: "1px solid #d7e6dc", borderRadius: 16, background: "#ffffff" }}>
                    <div>
                      <p className="eyebrow">Runde {round.round_number}</p>
                      <h3 style={{ margin: "4px 0" }}>{round.name}</h3>
                      <span style={{ color: "#718078" }}>{round.played_at ? formatDate(round.played_at) : "Dato følger"} · {round.courses?.club_name ?? "Bane følger"}</span>
                    </div>
                    <div className="tgt-round-actions">
                      <button type="button" onClick={() => openRound(round)} className="login-submit-button" style={{ width: "auto", marginTop: 0 }}>{statusLabel}</button>
                      <button type="button" onClick={() => openRoundClosest(round)} className="login-cancel-button" style={{ width: "auto", marginTop: 0 }}>Tættest på pinden</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!loading && !errorMessage && tab === "season" && (
            <div className="table-wrapper tgt-season-leaderboard">
              <table>
                <thead>
                  <tr>
                    <th className="position-column">#</th>
                    <th>Spiller</th>
                    <th className="number-column">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {cumulativeStandings.map((player, index) => {
                    const isOpen =
                      selectedPlayerMode === "season" &&
                      selectedPlayer?.player_id === player.player_id;
                    const playerRounds = [
                      ...(seasonRoundHistory[player.player_id] ?? []),
                    ].sort((a, b) => a.roundNumber - b.roundNumber);
                    const countingRoundNumbers = new Set(
                      [...playerRounds]
                        .sort((a, b) =>
                          a.scoreToPar !== b.scoreToPar
                            ? a.scoreToPar - b.scoreToPar
                            : a.roundNumber - b.roundNumber
                        )
                        .slice(0, Math.min(4, playerRounds.length))
                        .map((round) => round.roundNumber)
                    );

                    return (
                      <Fragment key={player.player_id}>
                        <tr
                          className={`tgt-live-player-row${isOpen ? " is-open" : ""}`}
                          onClick={() => {
                            setSelectedPlayer(isOpen ? null : player);
                            setSelectedPlayerMode(isOpen ? null : "season");
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <td className="position-column tgt-position-cell">
                            <span className={`position-badge position-${index + 1}`}>
                              {index + 1}
                            </span>
                            <PositionMovement
                              value={cumulativeIndividualMovements[String(player.player_id)] ?? 0}
                            />
                          </td>
                          <td><span className="player-name">{player.player_name}</span></td>
                          <td className="number-column final-score">
                            {formatScore(player.counting_score)}
                            {individualLiveCumulativeActive && (
                              <small style={{ display: "block", marginTop: 3, color: "#78827d", fontSize: 10 }}>
                                LIVE · {player.live_holes ?? 0}/18
                              </small>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan="3" style={{ padding: 0 }}>
                              <div style={{ padding: 20, background: "linear-gradient(145deg, #041f17, #083e2d)", borderTop: "1px solid rgba(255,255,255,.55)", borderBottom: "1px solid rgba(255,255,255,.55)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.025)" }}>
                                <div style={{ marginBottom: 18 }}>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setProfilePlayerId(profilePlayerId === player.player_id ? null : player.player_id);
                                  }}
                                  style={{ width: "100%", minHeight: 46, marginTop: 14, border: "1px solid #168454", borderRadius: 12, background: "linear-gradient(145deg, #073727, #0b513a)", color: "#ffffff", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.18)", fontWeight: 900, cursor: "pointer" }}
                                >
                                  SPILLERPROFIL
                                </button>
                                {profilePlayerId === player.player_id && (() => {
                                  const livePlayer = (liveData?.leaderboard ?? []).find((entry) => entry.playerId === player.player_id);
                                  const scoredHoles = (livePlayer?.scorecard ?? []).filter((hole) => hole.toPar !== null);
                                  const stats = scoredHoles.reduce((acc, hole) => {
                                    if (hole.toPar <= -2) acc.eagles += 1;
                                    else if (hole.toPar === -1) acc.birdies += 1;
                                    else if (hole.toPar === 0) acc.pars += 1;
                                    else if (hole.toPar === 1) acc.bogeys += 1;
                                    else acc.doublePlus += 1;
                                    return acc;
                                  }, { eagles: 0, birdies: 0, pars: 0, bogeys: 0, doublePlus: 0 });
                                  return (
                                    <div style={{ marginTop: 14, padding: 20, borderRadius: 18, background: "linear-gradient(145deg, #052a1f, #0a4633)", color: "#ffffff", border: "1px solid rgba(255,255,255,.5)", boxShadow: "0 12px 30px rgba(1,18,13,.22)" }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
                                        <div style={{ width: 78, height: 78, minWidth: 78, display: "grid", placeItems: "center", borderRadius: "50%", border: "2px solid #ffffff", background: "radial-gradient(circle at 30% 25%, #eaf5ee, #168454)", color: "#133528", fontFamily: "Georgia, serif", fontSize: 27, fontWeight: 900, boxShadow: "0 8px 28px rgba(255,255,255,.3)" }}>{getInitials(player.player_name)}</div>
                                        <div><p className="eyebrow" style={{ color: "#d8bc74", marginBottom: 5 }}>The Golden Tee Tour</p><h3 style={{ margin: 0, color: "#ffffff", fontSize: 25 }}>{player.player_name}</h3><span style={{ color: "rgba(255,255,255,.7)" }}>TGT spillerprofil · {ACTIVE_SEASON}</span></div>
                                      </div>
                                      <div className="flight-information tgt-profile-kpis">
                                        <div><span style={{ color: "#dff0e5" }}>Handicap</span><strong style={{ color: "#ffffff" }}>{playerDirectory[player.player_id]?.handicap_index ?? livePlayer?.handicap ?? "–"}</strong></div>
                                        <div><span style={{ color: "#dff0e5" }}>Placering</span><strong style={{ color: "#ffffff" }}>{index + 1}</strong></div>
                                        <div><span style={{ color: "#dff0e5" }}>Sæsonscore</span><strong style={{ color: "#ffffff" }}>{formatScore(player.counting_score)}</strong></div>
                                        <div><span style={{ color: "#dff0e5" }}>Spillede runder</span><strong style={{ color: "#ffffff" }}>{player.rounds_played ?? playerRounds.length}</strong></div>
                                        <div><span style={{ color: "#dff0e5" }}>Bedste runde</span><strong style={{ color: "#ffffff" }}>{playerRounds.length ? formatScore(Math.min(...playerRounds.map((round) => round.scoreToPar))) : "–"}</strong></div>
                                        <div><span style={{ color: "#dff0e5" }}>🍺 Damebajere</span><strong style={{ color: "#ffffff" }}>{damebajerCounts[player.player_id] ?? 0}</strong></div>
                                      </div>
                                      <h4 style={{ margin: "20px 0 10px", color: "#ffffff" }}>Scorestatistik fra gemte scorekort</h4>
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: 9 }}>
                                        {[["Eagles+", stats.eagles, "3px double #47b979", "50%"], ["Birdies", stats.birdies, "2px solid #54c981", "50%"], ["Pars", stats.pars, "1px solid #819289", "12px"], ["Bogeys", stats.bogeys, "2px solid #d39b48", "3px"], ["Double+", stats.doublePlus, "3px double #d2675f", "3px"]].map(([label, value, border, radius]) => (
                                          <div key={label} style={{ padding: 12, textAlign: "center", border, borderRadius: radius, background: "linear-gradient(145deg, #073727, #0a4935)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)" }}><strong style={{ display: "block", fontSize: 22, color: "#ffffff" }}>{value}</strong><small style={{ color: "#dff0e5", fontWeight: 800 }}>{label}</small></div>
                                        ))}
                                      </div>
                                      {scoredHoles.length === 0 && <p style={{ marginBottom: 0, color: "rgba(255,255,255,.68)" }}>Hulstatistik udfyldes automatisk fra kommende gemte scorekort.</p>}
                                    </div>
                                  );
                                })()}
                                </div>
                                <strong style={{ display: "block", color: "#ffffff", fontSize: 16, marginBottom: 10 }}>Tidligere runder</strong>
                                {playerRounds.length === 0 ? (
                                  <p style={{ marginBottom: 0, color: "#dff0e5" }}>
                                    Der er ingen registrerede runder for spilleren.
                                  </p>
                                ) : (
                                  <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                    {playerRounds.map((round) => {
                                      const roundKey = `${player.player_id}-${round.roundId}`;
                                      const scorecardOpen = expandedHistoricalRoundKey === roundKey;
                                      return (
                                        <div key={roundKey} style={{ borderRadius: 12, background: "#073727", border: "1px solid rgba(255,255,255,.38)", color: "#ffffff", overflow: "hidden" }}>
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              if (round.hasScorecard) {
                                                setExpandedHistoricalRoundKey(scorecardOpen ? null : roundKey);
                                              }
                                            }}
                                            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: 14, border: 0, background: "transparent", color: "inherit", cursor: round.hasScorecard ? "pointer" : "default", textAlign: "left" }}
                                          >
                                            <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 9 }}>
                                              Runde {round.roundNumber}
                                              {countingRoundNumbers.has(round.roundNumber) && <small style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.5)", color: "#ffffff", fontWeight: 900, letterSpacing: ".06em" }}>TÆLLENDE</small>}
                                              {round.hasScorecard && <small style={{ color: "#dff0e5", fontWeight: 800 }}>{scorecardOpen ? "Luk scorekort" : "Se scorekort"}</small>}
                                            </span>
                                            <strong style={{ color: "#ffffff", fontSize: 17 }}>{formatScore(round.scoreToPar)}</strong>
                                          </button>
                                          {scorecardOpen && round.hasScorecard && (
                                            <SplitScorecard scorecard={round.scorecard} />
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !errorMessage && tab === "live" && !liveData?.round && (
            <section className="leaderboard-card" style={{textAlign:"center",padding:"42px 20px"}}>
              <p className="eyebrow">LIVE</p><h2 style={{margin:"8px 0"}}>Ingen aktiv runde</h2>
              <p className="description">Livescore vises automatisk, når en runde er sat til live.</p>
            </section>
          )}
          {!loading && !errorMessage && tab === "live" && Boolean(liveData?.round) && (!liveFullscreen || liveView === "individual") && (
            <>
              {["individual", "both"].includes(liveLeaderboardMode) && (
                <PublicLiveTopFive type="individual" />
              )}
              {liveLeaderboardMode === "team" && (
                <PublicLiveTopFive type="team" />
              )}
              <div className="table-wrapper tgt-live-gamebook">
              <div className="tgt-live-mobile-list">
                <div className="tgt-live-mobile-head">
                  <span>#</span>
                  <span>Spiller</span>
                  <span>Score</span>
                  <span>Thru</span>
                </div>
                {liveLeaderboard.map((player, index) => {
                  const isOpen =
                    selectedPlayerMode === "live" &&
                    selectedPlayer?.playerId === player.playerId;

                  return (
                    <article key={`mobile-${player.playerId}`} className={`tgt-live-mobile-card${isOpen ? " is-open" : ""}`}>
                      <button
                        type="button"
                        className="tgt-live-mobile-player"
                        onClick={() => {
                          setSelectedPlayer(isOpen ? null : player);
                          setSelectedPlayerMode(isOpen ? null : "live");
                        }}
                      >
                        <span className={`position-badge position-${index + 1}`}>{index + 1}</span>
                        <span className="tgt-live-mobile-name">
                          <strong>{player.playerName}</strong>
                          <small>HCP {player.handicap ?? "–"} · SPH {getPlayerPlayingHandicap(player, liveData?.round) ?? "–"}</small>
                        </span>
                        <span className="tgt-live-mobile-score-wrap">
                          <strong className="tgt-live-mobile-score" style={getLeaderboardScoreStyle(player.holesPlayed === 0 ? 0 : player.scoreToPar)}>
                            {player.holesPlayed === 0 ? "E" : formatScore(player.scoreToPar)}
                          </strong>
                        </span>
                        <strong className="tgt-live-mobile-thru">{player.holesPlayed}</strong>
                      </button>
                      {isOpen && (
                        <div className="tgt-live-mobile-scorecard">
                          <SplitScorecard
                            scorecard={player.scorecard ?? []}
                            handicapIndex={player.handicapIndex ?? player.handicap}
                            playingHandicap={getPlayerPlayingHandicap(player, liveData?.round)}
                            position={index + 1}
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
              <table className="tgt-live-desktop-table">
                <thead>
                  <tr>
                    <th className="position-column">#</th>
                    <th>Spiller</th>
                    <th className="number-column">Score</th>
                    <th className="number-column">Til par</th>
                    <th className="number-column">Bonus</th>
                    <th className="number-column">Thru</th>
                  </tr>
                </thead>
                <tbody>
                  {liveLeaderboard.map((player, index) => {
                    const isOpen =
                      selectedPlayerMode === "live" &&
                      selectedPlayer?.playerId === player.playerId;

                    return (
                      <Fragment key={player.playerId}>
                        <tr
                          onClick={() => {
                            setSelectedPlayer(isOpen ? null : player);
                            setSelectedPlayerMode(isOpen ? null : "live");
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <td className="position-column tgt-position-cell">
                            <span className={`position-badge position-${index + 1}`}>{index + 1}</span>
                          </td>
                          <td>
                            <span className="player-name">{player.playerName}</span>
                            <small className="tgt-live-player-meta">HCP {player.handicap ?? "–"} · SPH {getPlayerPlayingHandicap(player, liveData?.round) ?? "–"}</small>
                          </td>
                          <td className="number-column tgt-live-gross-score">{player.holesPlayed === 0 ? "–" : player.grossStrokes}</td>
                          <td className="number-column final-score tgt-live-to-par" style={getLeaderboardScoreStyle(player.holesPlayed === 0 ? 0 : player.scoreToPar)}>{player.holesPlayed === 0 ? "E" : formatScore(player.scoreToPar)}</td>
                          <td className="number-column tgt-live-bonus">{player.earnedBonus > 0 ? player.hasCompletedRound ? `-${player.appliedBonus}` : `${player.earnedBonus} afventer` : "–"}</td>
                          <td className="number-column tgt-live-thru">{player.holesPlayed}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan="6" style={{ padding: 0 }}>
                              <div className="tgt-live-scorecard-detail">
                                <strong>{player.playerName} · scorekort efter {player.holesPlayed} huller</strong>
                                <SplitScorecard scorecard={player.scorecard ?? []} handicapIndex={player.handicapIndex ?? player.handicap} playingHandicap={getPlayerPlayingHandicap(player, liveData?.round)} position={index + 1} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {liveLeaderboard.length === 0 && (
                <div className="status-box">Der er ingen deltagere i den valgte runde.</div>
              )}
              </div>
            </>
          )}

          {!loading && !errorMessage && tab === "live" && Boolean(liveData?.round) && liveFullscreen && liveView === "team" && (
            <>
              {["team", "both"].includes(liveLeaderboardMode) && (
                <PublicLiveTopFive type="team" />
              )}
              <div className="table-wrapper tgt-live-team-leaderboard">
              <table>
                <thead>
                  <tr>
                    <th className="position-column">#</th>
                    <th>Hold</th>
                    <th className="number-column">Score</th>
                    <th className="number-column">Thru</th>
                  </tr>
                </thead>
                <tbody>
                  {teamLeaderboard.map((team, index) => {
                    const teamKey = team.teamId ?? team.id ?? `${team.teamName}-${index}`;
                    const isOpen = selectedTeamId === teamKey;
                    const teamScoreToPar = getTeamScoreToPar(team);
                    const teamHolesPlayed = team.holesPlayed ?? team.thru ?? normalizeTeamScorecard(team.scorecard ?? []).filter((hole) => hasActualScore(hole.netStrokes)).length;
                    return (
                      <Fragment key={teamKey}>
                        <tr className={isOpen ? "is-open" : ""} onClick={() => setSelectedTeamId(isOpen ? null : teamKey)} style={{ cursor: "pointer" }}>
                          <td className="position-column tgt-position-cell"><span className={`position-badge position-${index + 1}`}>{index + 1}</span></td>
                          <td><span className="player-name">{team.teamName ?? team.name ?? "Ukendt hold"}</span><small className="tgt-live-player-meta">Tryk for best ball-scorekort</small></td>
                          <td className="number-column final-score tgt-live-to-par" style={getLeaderboardScoreStyle(teamScoreToPar ?? 0)}>{teamHolesPlayed === 0 ? "E" : formatScore(teamScoreToPar)}</td>
                          <td className="number-column tgt-live-thru">{teamHolesPlayed}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan="4" style={{ padding: 0 }}>
                              <div className="tgt-live-scorecard-detail tgt-team-best-ball-detail">
                                <SplitScorecard scorecard={normalizeTeamScorecard(team.scorecard ?? [])} position={index + 1} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {teamLeaderboard.length === 0 && (
                <div className="status-box">Der er endnu ingen live holdscore for den valgte runde.</div>
              )}
              </div>
            </>
          )}
          {!loading && !errorMessage && tab === "team" && (
            <div className="table-wrapper tgt-team-leaderboard">
              <table>
                <thead>
                  <tr>
                    <th className="position-column">#</th>
                    <th>Hold</th>
                    <th className="number-column">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {cumulativeTeamStandings.map((team, index) => {
                    const isOpen = selectedTeamId === team.teamId;
                    return (
                      <Fragment key={team.teamId}>
                        <tr
                          onClick={() =>
                            setSelectedTeamId(isOpen ? null : team.teamId)
                          }
                          style={{ cursor: "pointer" }}
                        >
                          <td className="position-column tgt-position-cell">
                            <span className={`position-badge position-${index + 1}`}>
                              {index + 1}
                            </span>
                            <PositionMovement
                              value={cumulativeTeamMovements[String(team.teamId)] ?? 0}
                            />
                          </td>
                          <td>
                            <span className="player-name">{team.teamName}</span>
                          </td>
                          <td className="number-column final-score">
                            {formatScore(
                              teamLiveCumulativeActive
                                ? team.cumulativeScore
                                : team.halvedScore
                            )}
                            {teamLiveCumulativeActive && (
                              <small style={{ display: "block", marginTop: 3, color: "#78827d", fontSize: 10 }}>
                                LIVE · {team.liveHoles ?? 0}/18
                              </small>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan="3" style={{ padding: 0 }}>
                              <div className="tgt-team-profile">
                                <div className="tgt-team-profile-header">
                                  <div className="tgt-team-avatar">
                                    {team.teamName
                                      .split("&")
                                      .map((name) => name.trim()[0]?.toUpperCase())
                                      .join("")}
                                  </div>
                                  <div>
                                    <p className="eyebrow" style={{ color: "#dff0e5", marginBottom: 5 }}>
                                      TGT holdprofil · {selectedSeason}
                                    </p>
                                    <h3 style={{ margin: 0, color: "#ffffff", fontSize: 22 }}>
                                      {team.teamName}
                                    </h3>
                                    <span style={{ color: "rgba(245,220,147,.72)" }}>
                                      Placering {index + 1} · {team.roundsPlayed} spillede runder
                                    </span>
                                  </div>
                                </div>
                                <div className="tgt-team-rounds">
                                  {team.rounds
                                    .sort((a, b) => a.roundNumber - b.roundNumber)
                                    .map((round) => (
                                      <div key={round.roundNumber} className="tgt-team-round">
                                        <span>Runde {round.roundNumber}</span>
                                        <strong>{formatScore(round.score)}</strong>
                                      </div>
                                    ))}
                                </div>
                                <div className="tgt-team-final-kpi">
                                  <span>Bedste 4, halveret før holdfinalen</span>
                                  <strong>{formatScore(team.halvedScore)}</strong>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {historicalTeamStandings.length === 0 && (
                <div className="status-box">Der er ingen historiske holdresultater.</div>
              )}
            </div>
          )}

          {!loading && !errorMessage && tab === "closest" && (
            <div style={{ padding: 20 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                {parThreeHoles.map((hole) => {
                  const leader = closestLeaders.find(
                    (entry) =>
                      Number(entry.hole_number) ===
                      Number(hole.hole_number)
                  );

                  return (
                    <article
                      key={hole.hole_number}
                      style={{
                        padding: 18,
                        border: "1px solid #e0e8e2",
                        borderRadius: 16,
                        background: leader ? "#f1f8f3" : "#fafbf9",
                      }}
                    >
                      <p className="eyebrow">
                        Hul {hole.hole_number} · Par {hole.par}
                      </p>

                      {leader ? (
                        <>
                          <h3 style={{ margin: "5px 0" }}>
                            {leader.players?.name ?? "Ukendt spiller"}
                          </h3>
                          <div
                            className="final-score"
                            style={{ marginTop: 8 }}
                          >
                            {Number(leader.distance_meters).toLocaleString(
                              "da-DK",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )} meter
                          </div>
                          <small
                            style={{
                              display: "block",
                              marginTop: 8,
                              color: "#78827d",
                            }}
                          >
                            {leader.flights?.name ?? "Bold ikke angivet"}
                          </small>
                        </>
                      ) : (
                        <div className="status-box" style={{ margin: "12px 0 0" }}>
                          Afventer første kandidat
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              {parThreeHoles.length === 0 && (
                <div className="status-box">
                  Der blev ikke fundet par 3-huller på banen.
                </div>
              )}
            </div>
          )}

          {!loading && !errorMessage && tab === "final" && (
            <div>
              {finalStandingsData ? (
                <>
                  {finalStandingsData.champion && (
                    <section
                      style={{
                        margin: 20,
                        padding: 22,
                        borderRadius: 18,
                        color: "#ffffff",
                        background:
                          "linear-gradient(135deg, #0b4935, #18704e)",
                      }}
                    >
                      <p
                        className="eyebrow"
                        style={{ color: "#dafaaf" }}
                      >
                        TGT-mester {ACTIVE_SEASON}
                      </p>
                      <h2 style={{ margin: "5px 0" }}>
                        {finalStandingsData.champion.playerName}
                      </h2>
                      <strong style={{ fontSize: 24 }}>
                        {formatScore(
                          finalStandingsData.champion.finalScore
                        )}
                      </strong>
                    </section>
                  )}

                  {!finalStandingsData.finalCompleted && (
                    <div className="status-box">
                      Foreløbig stilling. {finalStandingsData.completedPlayers} af 15
                      spillere har gennemført hele finaleforløbet.
                    </div>
                  )}

                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th className="position-column">Placering</th>
                          <th>Spiller</th>
                          <th className="number-column">Udgangspunkt</th>
                          <th className="number-column">Runde 6</th>
                          <th className="number-column">Runde 7</th>
                          <th className="number-column">Samlet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finalStandingsData.standings.map((player) => (
                          <tr key={player.playerId}>
                            <td className="position-column">
                              <span
                                className={`position-badge position-${player.position}`}
                              >
                                {player.position}
                              </span>
                            </td>
                            <td>
                              <span className="player-name">
                                {player.playerName}
                              </span>
                              <small
                                style={{
                                  display: "block",
                                  color: "#78827d",
                                }}
                              >
                                Runde 6: {player.roundSixHoles}/18 · Runde 7:{" "}
                                {player.roundSevenHoles}/18
                              </small>
                            </td>
                            <td className="number-column">
                              {formatScore(player.startingScore)}
                            </td>
                            <td className="number-column">
                              {player.roundSixHoles === 0
                                ? "Ikke startet"
                                : formatScore(player.roundSixOfficialScore)}
                            </td>
                            <td className="number-column">
                              {player.roundSevenHoles === 0
                                ? "Ikke startet"
                                : formatScore(player.roundSevenOfficialScore)}
                            </td>
                            <td className="number-column final-score">
                              {player.finalScore === null || player.finalScore === undefined
                                ? "Afventer"
                                : formatScore(player.finalScore)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="status-box">
                  Finalestillingen kunne ikke beregnes endnu. Kontrollér, at
                  Runde 6 og Runde 7 findes og har deltagere.
                </div>
              )}
            </div>
          )}

          {!loading && !errorMessage && tab === "hall" && (
            <div style={{ padding: 20 }}>
              {hallOfFame.length === 0 ? (
                <div className="status-box" style={{ margin: 0 }}>Ingen afsluttede TGT-sæsoner endnu.</div>
              ) : (
                <div className="tgt-hof-grid">
                  {hallOfFame.map((entry) => (
                    <article key={entry.id} className="tgt-hof-card">
                      <header className="tgt-hof-top">
                        <div className="tgt-hof-trophy" aria-hidden="true">🏆</div>
                        <p className="tgt-hof-kicker">The Golden Tee Tour · Hall of Fame</p>
                        <h2 className="tgt-hof-year">{entry.season}</h2>
                      </header>
                      <section className="tgt-hof-winner"><span>Individuel mester</span><strong>{entry.individualChampionName}</strong></section>
                      {entry.teamChampionName && <section className="tgt-hof-winner"><span>Holdmestre</span><strong>{entry.teamChampionName}</strong></section>}
                      <div className="tgt-hof-course"><span aria-hidden="true">◆</span><span>{entry.finalCourse ?? "Finalebane ikke registreret"}</span></div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card-footer">
            <span>Data hentes direkte fra TGT-databasen</span>
            <span>Sæson {selectedSeason}</span>
          </div>
        </section>
      </main>
      
      {onPortalNavigate && <MitTgtBottomNav active={initialPortalView === "live-leaderboard" ? "live" : "leaderboard"} onProfile={()=>onPortalNavigate("profile")} onLeaderboard={()=>onPortalNavigate("leaderboard")} onPlay={()=>onPortalNavigate("play")} onLive={()=>onPortalNavigate("live-leaderboard")} onMenu={()=>onPortalNavigate("menu")} />}
    </div>
  );
}

function PlayerLogin({ onCancel, onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  async function handleLogin(event) {
    event.preventDefault(); setLoggingIn(true); setLoginError("");
    const normalized = username.trim().toLowerCase().replace(/\s+/g, "");
    const email = normalized.includes("@") ? normalized : `${normalized}@tgt.dk`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setLoginError("Login mislykkedes. Kontrollér brugernavn/e-mail og kodeord."); setLoggingIn(false); return; }
    setLoggingIn(false); onLoginSuccess(data.session);
  }
  return <main className="login-page tgt-fresh-login"><style>{`
    .tgt-fresh-login{min-height:100dvh;background:linear-gradient(150deg,#064a34,#11905a 58%,#dff0e5)!important}
    .tgt-fresh-login .login-card{border:1px solid rgba(255,255,255,.38)!important;border-radius:26px!important;background:rgba(255,255,255,.96)!important;box-shadow:0 24px 60px rgba(6,63,43,.24)!important}
    .tgt-fresh-login .login-icon{background:linear-gradient(145deg,#25a96a,#08784c)!important;color:#fff!important}
    .tgt-fresh-login .eyebrow{color:#168454!important}.tgt-fresh-login h1{color:#073f2c!important}
    .tgt-fresh-login .login-submit-button{background:linear-gradient(135deg,#1b985f,#0c7048)!important;color:#fff!important}
    .tgt-fresh-login .login-cancel-button{border-color:#c5ddcd!important;color:#0b6543!important;background:#fff!important}
    .tgt-fresh-login .form-input:focus{border-color:#168454!important;box-shadow:0 0 0 3px rgba(22,132,84,.14)!important}
  
        /* Release rule: menu-driven navigation and zero gold outside Hall of Fame */
        .tgt-individual-back-button,.tgt-team-back-button,.tgt-live-back-button,.tgt-panel-back-button{display:none!important}
        .tgt-player-shell,.tgt-public-shell,.tgt-menu-page,.tgt-ops-shell{--tgt-accent:#168454;--tgt-accent-light:#eaf5ee;--tgt-ink:#113c2d}
        .tgt-player-shell .eyebrow,.tgt-ops-shell .eyebrow,.tgt-menu-page .eyebrow{color:#168454!important}
        .tgt-player-head .eyebrow,.tgt-player-head h1,.tgt-player-head span,.tgt-marker-live-header,.marker-header h1,.marker-header .eyebrow{color:#fff!important}
        .tgt-player-avatar,.tgt-team-avatar{color:#fff!important;background:linear-gradient(145deg,#27a467,#08794c)!important;border-color:#fff!important;box-shadow:none!important}
        .tgt-player-kpi,.tgt-player-panel,.tgt-player-stat,.tgt-team-profile,.tgt-team-round,.tgt-team-final-kpi,.tgt-profile-directory-card,.tgt-directory-stat,.tgt-final-flow-card,.tgt-marker-kpi,.tgt-course-db-count,.tgt-tee-grid article{border-color:#d7e6dc!important;color:#113c2d!important;background:#fff!important;box-shadow:0 8px 22px rgba(7,63,44,.07)!important}
        .tgt-player-kpi span,.tgt-player-stat small,.tgt-team-round span,.tgt-directory-stat small,.tgt-final-flow-card span,.tgt-marker-kpi span,.tgt-course-db-count span,.tgt-tee-grid article span,.tgt-tee-grid article small{color:#688077!important}
        .tgt-player-kpi strong,.tgt-player-stat strong,.tgt-team-round strong,.tgt-team-final-kpi strong,.tgt-directory-stat strong,.tgt-final-flow-card strong,.tgt-marker-kpi strong,.tgt-course-db-count strong,.tgt-tee-grid article strong{color:#0b6543!important}
        .tgt-player-result strong,.final-score,.tgt-public-live-top-five-row>span:nth-last-child(2),.tgt-marker-top-five-row>span:nth-last-child(2){color:#0b6543!important}
        .tgt-ops-shell>.marker-card,.tgt-player-home{border-color:rgba(255,255,255,.22)!important}
        .tgt-ops-shell .marker-header,.tgt-marker-live-header,.tgt-marker-top-five-card>header,.tgt-marker-live-table thead{border-color:rgba(255,255,255,.16)!important;color:#fff!important;background:linear-gradient(135deg,#075238,#0a6845)!important}
        .tgt-ops-shell .logout-button,.tgt-marker-live-back,.tgt-marker-live-refresh{border-color:rgba(255,255,255,.34)!important;color:#fff!important;background:rgba(255,255,255,.12)!important}
        .tgt-marker-live-toggle button.active,.tgt-course-list button.active{border-color:#168454!important;color:#fff!important;background:#168454!important}
        .tgt-marker-live-table th{color:#fff!important;border-bottom-color:rgba(255,255,255,.18)!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1,.tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1 span{color:#fff!important;background:none!important;-webkit-text-fill-color:#fff!important;filter:none!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-kicker{border-color:rgba(255,255,255,.38)!important;color:#fff!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-primary-action{border-color:#fff!important;color:#fff!important;background:#168454!important}
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.20)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(238,250,242,.72)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(255,255,255,.14)!important}.tgt-fixed-play-disc{border-color:#fff!important;color:#fff!important;background:linear-gradient(145deg,#ef5a61,#c9323a)!important}
`}</style><section className="login-card"><div className="login-icon">⛳</div><p className="eyebrow">MIT TGT</p><h1>Mit TGT-login</h1><p className="description">Log ind på din personlige TGT-side.</p><form onSubmit={handleLogin}><label className="form-label">Brugernavn eller e-mail</label><input type="text" value={username} onChange={(event)=>setUsername(event.target.value)} placeholder="Brugernavn eller e-mail" autoComplete="username" required className="form-input"/><label className="form-label">Kodeord</label><input type="password" value={password} onChange={(event)=>setPassword(event.target.value)} placeholder="Indtast kodeord" autoComplete="current-password" required className="form-input"/>{loginError&&<div className="error-box">{loginError}</div>}<button type="submit" disabled={loggingIn} className="login-submit-button">{loggingIn?"Logger ind...":"Log ind"}</button><button type="button" onClick={onCancel} className="login-cancel-button">Tilbage til den offentlige side</button></form></section></main>;
}
function MitTgtMenuPage({ onNavigate, onLogout }) {
  const menuItems = [
    { title: "Min profil", subtitle: "Profil, handicap og statistik", view: "profile", icon: "person" },
    { title: "Leaderboard", subtitle: "Individuel sæsonstilling", view: "leaderboard", icon: "chart" },
    { title: "Holdturneringen", subtitle: "Holdstilling og resultater", view: "team", icon: "team" },
    { title: "Livescore", subtitle: "Vises kun ved en aktiv runde", view: "live-leaderboard", icon: "live" },
    { title: "Runder", subtitle: "Program, baner og tidligere runder", view: "rounds", icon: "calendar" },
    { title: "Spillerprofiler", subtitle: "Spillere, klubber og statistik", view: "profiles", icon: "players" },
    { title: "Tættest på pinden", subtitle: "Par 3-konkurrencen", view: "closest", icon: "target" },
    { title: "Hall of Fame", subtitle: "Tidligere mestre og holdvindere", view: "hall", icon: "trophy" },
    { title: "Scoreindtastning", subtitle: "Åbn din bold og indtast scorer", view: "play", icon: "flag" },
  ];
  const icon = (name) => {
    const icons = {
      person: <><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6"/></>,
      chart: <><path d="M5 19V11M12 19V5M19 19v-8"/></>,
      team: <><circle cx="8" cy="9" r="2.5"/><circle cx="16" cy="9" r="2.5"/><path d="M3.5 19c.4-3.2 1.9-4.8 4.5-4.8s4.1 1.6 4.5 4.8M11.5 19c.4-3.2 1.9-4.8 4.5-4.8s4.1 1.6 4.5 4.8"/></>,
      live: <><path d="m12 3 8 9-8 9-8-9 8-9Z"/><circle cx="12" cy="12" r="2"/></>,
      calendar: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></>,
      players: <><circle cx="9" cy="8" r="3"/><path d="M3 20c.4-4 2.4-6 6-6s5.6 2 6 6M16 6.5a3 3 0 0 1 0 5.8M17 14c2.4.6 3.7 2.5 4 6"/></>,
      target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></>,
      trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM9 20h6M12 13v7M8 6H4v2c0 2 1.3 3 4 3M16 6h4v2c0 2-1.3 3-4 3"/></>,
      flag: <><path d="M7 21V4M8 5h9l-2.5 3L17 11H8"/></>,
    };
    return icons[name] ?? icons.flag;
  };
  return <main className="tgt-menu-page">
    <section className="tgt-menu-page-shell">
      <header className="tgt-menu-page-head"><div><p>MIT TGT</p><h1>Menu</h1><span>Vælg hvor du vil hen</span></div></header>
      <div className="tgt-menu-page-grid">
        {menuItems.map((item)=><button type="button" key={item.view} onClick={()=>onNavigate(item.view)}><span className="tgt-menu-page-icon"><svg viewBox="0 0 24 24" aria-hidden="true">{icon(item.icon)}</svg></span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><b aria-hidden="true">›</b></button>)}
      </div>
      <button type="button" className="tgt-menu-page-logout" onClick={onLogout}>Log ud</button>
    </section>
    <MitTgtBottomNav active="menu" onProfile={()=>onNavigate("profile")} onLeaderboard={()=>onNavigate("leaderboard")} onPlay={()=>onNavigate("play")} onLive={()=>onNavigate("live-leaderboard")} onMenu={()=>onNavigate("profile")} />
    <style>{`
      .tgt-menu-page{min-height:100dvh;padding:18px 14px calc(112px + env(safe-area-inset-bottom));color:#113c2d;background:linear-gradient(180deg,#dff0e5,#f7faf7 34%,#eef5f0)}
      .tgt-menu-page-shell{width:min(860px,100%);margin:0 auto;overflow:hidden;border:1px solid rgba(15,117,75,.16);border-radius:28px;background:rgba(255,255,255,.95);box-shadow:0 18px 48px rgba(7,63,44,.12)}
      .tgt-menu-page-head{padding:34px 24px;color:#fff;background:linear-gradient(145deg,#086844,#0e8654 62%,#167348)}
      .tgt-menu-page-head p{margin:0 0 6px;font-size:11px;font-weight:900;letter-spacing:.18em}.tgt-menu-page-head h1{margin:0;font:700 clamp(40px,7vw,62px)/1 Georgia,serif}.tgt-menu-page-head span{display:block;margin-top:10px;color:rgba(255,255,255,.76)}
      .tgt-menu-page-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:18px}.tgt-menu-page-grid button{width:100%;min-height:82px;display:grid;grid-template-columns:50px 1fr 20px;align-items:center;gap:14px;padding:14px 16px;border:1px solid #d7e6dc;border-radius:20px;color:#113c2d;background:#fff;text-align:left;box-shadow:0 8px 22px rgba(7,63,44,.06)}
      .tgt-menu-page-grid button:active{transform:scale(.985)}.tgt-menu-page-icon{width:46px;height:46px;display:grid;place-items:center;border-radius:15px;color:#fff;background:linear-gradient(145deg,#27a467,#08794c)}.tgt-menu-page-icon svg{width:25px;height:25px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.tgt-menu-page-grid strong{display:block;font-size:17px}.tgt-menu-page-grid small{display:block;margin-top:4px;color:#688077;font-size:12px}.tgt-menu-page-grid b{color:#df454d;font-size:28px;font-weight:400}
      .tgt-menu-page-logout{display:block;width:calc(100% - 36px);min-height:50px;margin:0 18px 22px;border:1px solid rgba(223,69,77,.32);border-radius:16px;color:#b92f37;background:#fff;font-weight:900}
      .tgt-menu-page-head h1{color:#fff!important}
      .tgt-menu-page .tgt-fixed-bottom-nav{position:fixed!important;left:50%!important;right:auto!important;bottom:max(10px,env(safe-area-inset-bottom))!important;z-index:10000!important;width:min(620px,calc(100% - 20px))!important;height:72px!important;display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;grid-template-rows:72px!important;align-items:center!important;gap:0!important;margin:0!important;padding:7px 10px!important;transform:translateX(-50%)!important;box-sizing:border-box!important;overflow:visible!important;border:1px solid rgba(255,255,255,.22)!important;border-radius:25px!important;background:linear-gradient(180deg,rgba(8,91,59,.99),rgba(5,65,45,.99))!important;box-shadow:0 16px 42px rgba(7,63,44,.30),inset 0 1px 0 rgba(255,255,255,.14)!important}
      .tgt-menu-page .tgt-fixed-nav-item{position:relative!important;appearance:none!important;width:100%!important;height:56px!important;min-width:0!important;min-height:56px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;margin:0!important;padding:0!important;visibility:visible!important;opacity:1!important;border:0!important;border-radius:17px!important;color:rgba(238,250,242,.72)!important;background:transparent!important;box-shadow:none!important}
      .tgt-menu-page .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(255,255,255,.14)!important}.tgt-menu-page .tgt-fixed-nav-item.is-active:not(.tgt-fixed-nav-play):after{content:"";position:absolute;left:50%;bottom:3px;width:4px;height:4px;transform:translateX(-50%);border-radius:50%;background:#df454d;box-shadow:0 0 12px rgba(223,69,77,.75)}
      .tgt-menu-page .tgt-fixed-nav-icon{width:23px!important;height:23px!important;display:block!important;color:currentColor!important}.tgt-menu-page .tgt-fixed-nav-icon svg{width:23px!important;height:23px!important;display:block!important;fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round!important;stroke-linejoin:round!important}.tgt-menu-page .tgt-fixed-nav-item small{display:block!important;color:currentColor!important;font-size:8px!important;font-weight:900!important;line-height:1!important;text-transform:uppercase!important}
      .tgt-menu-page .tgt-fixed-nav-play{width:64px!important;min-width:64px!important;max-width:64px!important;height:64px!important;min-height:64px!important;justify-self:center!important;align-self:center!important;margin:-25px auto 0!important;border-radius:50%!important}.tgt-menu-page .tgt-fixed-play-disc{width:60px!important;height:60px!important;display:grid!important;place-items:center!important;border:2px solid #fff!important;border-radius:50%!important;color:#fff!important;background:linear-gradient(145deg,#ef5a61,#c9323a)!important;box-shadow:0 12px 27px rgba(95,22,27,.28),0 0 0 6px rgba(7,86,56,.98)!important;font-size:11px!important;font-weight:1000!important;letter-spacing:.10em!important}
      @media(max-width:600px){.tgt-menu-page{padding:0 0 calc(104px + env(safe-area-inset-bottom))}.tgt-menu-page-shell{border:0;border-radius:0;box-shadow:none}.tgt-menu-page-head{padding:28px 18px}.tgt-menu-page-grid{grid-template-columns:1fr;padding:14px 10px}.tgt-menu-page-grid button{min-height:76px}.tgt-menu-page .tgt-fixed-bottom-nav{bottom:max(8px,env(safe-area-inset-bottom))!important;width:calc(100% - 18px)!important;height:70px!important;grid-template-rows:70px!important;padding:6px 8px!important;border-radius:23px!important}.tgt-menu-page .tgt-fixed-nav-item{height:54px!important;min-height:54px!important}.tgt-menu-page .tgt-fixed-nav-item small{font-size:7px!important}.tgt-menu-page .tgt-fixed-nav-play{margin:-23px auto 0!important}}
    
        /* FINAL AUTHENTICATED UI: no burger, no gold, fixed nav, full scroll room */
        .tgt-mit-tgt-universe,.tgt-player-shell,.tgt-menu-page{padding-bottom:calc(132px + env(safe-area-inset-bottom))!important}
        .tgt-mit-tgt-universe .main-content,.tgt-player-shell .tgt-player-content,.tgt-menu-page-shell{padding-bottom:64px!important;scroll-margin-bottom:140px!important}
        .tgt-mit-tgt-universe .tgt-public-login-choice,.tgt-mit-tgt-universe .tgt-menu-button,.tgt-player-menu-button{display:none!important}
        .tgt-mit-tgt-universe .tgt-public-topbar{justify-content:flex-start!important;background:linear-gradient(135deg,#075238,#0a6845)!important}
        .tgt-mit-tgt-universe .tgt-public-topbar:after{content:"MIT TGT"!important;left:auto!important;right:16px!important;transform:none!important;color:#fff!important;font:900 10px/1 system-ui,sans-serif!important;letter-spacing:.16em!important}
        .tgt-mit-tgt-universe .tgt-wordmark,.tgt-mit-tgt-universe .tgt-wordmark *,.tgt-player-appbar,.tgt-player-appbar *{color:#fff!important}
        .tgt-mit-tgt-universe .tgt-wordmark-mark,.tgt-player-brandmark{border-color:rgba(255,255,255,.46)!important;color:#fff!important;background:rgba(255,255,255,.10)!important}
        .tgt-mit-tgt-universe .eyebrow:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-player-shell .eyebrow{color:#168454!important}
        .tgt-mit-tgt-universe h1:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-mit-tgt-universe h2:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-mit-tgt-universe h3:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-player-shell h1,.tgt-player-shell h2,.tgt-player-shell h3{color:#113c2d!important}
        .tgt-player-head h1,.tgt-player-head h2,.tgt-player-head h3,.tgt-player-head p,.tgt-player-head span,.tgt-player-head .eyebrow,.tgt-menu-page-head h1,.tgt-menu-page-head p,.tgt-menu-page-head span{color:#fff!important}
        .tgt-mit-tgt-universe th,.tgt-mit-tgt-universe td,.tgt-mit-tgt-universe .player-name,.tgt-mit-tgt-universe .score,.tgt-mit-tgt-universe .score-value,.tgt-player-shell .player-name{color:#113c2d!important}
        .tgt-mit-tgt-universe .waiting,.tgt-mit-tgt-universe .pending,.tgt-mit-tgt-universe [class*="await"]{color:#688077!important}
        .tgt-mit-tgt-universe .tgt-tabs button,.tgt-mit-tgt-universe .tgt-tab,.tgt-mit-tgt-universe .tgt-filter-button{color:#0b6543!important;background:#fff!important;border-color:#c8ddd0!important}
        .tgt-mit-tgt-universe .tgt-tabs button.active,.tgt-mit-tgt-universe .tgt-tab.active,.tgt-mit-tgt-universe .tgt-filter-button.active{color:#fff!important;background:#168454!important;border-color:#168454!important}
        .tgt-mit-tgt-universe .live-badge,.tgt-mit-tgt-universe .tgt-live-badge{color:#fff!important;background:#df454d!important;border-color:#df454d!important}
        /* Classic podium palette remains visible */
        .tgt-mit-tgt-universe .position-badge.position-1,.tgt-mit-tgt-universe .position-1{color:#0b6543!important;background:#eaf5ee!important;border-color:#bcd6c5!important}
        .tgt-mit-tgt-universe .position-badge.position-2,.tgt-mit-tgt-universe .position-2{color:#33424b!important;background:#d9e0e4!important;border-color:#c4ced3!important}
        .tgt-mit-tgt-universe .position-badge.position-3,.tgt-mit-tgt-universe .position-3{color:#5c3214!important;background:#dca56f!important;border-color:#c98e54!important}
        .tgt-fixed-bottom-nav{bottom:max(10px,env(safe-area-inset-bottom))!important}
        @media(max-width:700px){
          .tgt-mit-tgt-universe,.tgt-player-shell,.tgt-menu-page{padding-bottom:calc(128px + env(safe-area-inset-bottom))!important}
          .tgt-mit-tgt-universe .main-content,.tgt-player-shell .tgt-player-content,.tgt-menu-page-shell{padding-bottom:68px!important}
          .tgt-mit-tgt-universe .tgt-public-topbar:after{right:12px!important}
          .tgt-fixed-bottom-nav{bottom:max(8px,env(safe-area-inset-bottom))!important}
        }

        /* Release rule: menu-driven navigation and zero gold outside Hall of Fame */
        .tgt-individual-back-button,.tgt-team-back-button,.tgt-live-back-button,.tgt-panel-back-button{display:none!important}
        .tgt-player-shell,.tgt-public-shell,.tgt-menu-page,.tgt-ops-shell{--tgt-accent:#168454;--tgt-accent-light:#eaf5ee;--tgt-ink:#113c2d}
        .tgt-player-shell .eyebrow,.tgt-ops-shell .eyebrow,.tgt-menu-page .eyebrow{color:#168454!important}
        .tgt-player-head .eyebrow,.tgt-player-head h1,.tgt-player-head span,.tgt-marker-live-header,.marker-header h1,.marker-header .eyebrow{color:#fff!important}
        .tgt-player-avatar,.tgt-team-avatar{color:#fff!important;background:linear-gradient(145deg,#27a467,#08794c)!important;border-color:#fff!important;box-shadow:none!important}
        .tgt-player-kpi,.tgt-player-panel,.tgt-player-stat,.tgt-team-profile,.tgt-team-round,.tgt-team-final-kpi,.tgt-profile-directory-card,.tgt-directory-stat,.tgt-final-flow-card,.tgt-marker-kpi,.tgt-course-db-count,.tgt-tee-grid article{border-color:#d7e6dc!important;color:#113c2d!important;background:#fff!important;box-shadow:0 8px 22px rgba(7,63,44,.07)!important}
        .tgt-player-kpi span,.tgt-player-stat small,.tgt-team-round span,.tgt-directory-stat small,.tgt-final-flow-card span,.tgt-marker-kpi span,.tgt-course-db-count span,.tgt-tee-grid article span,.tgt-tee-grid article small{color:#688077!important}
        .tgt-player-kpi strong,.tgt-player-stat strong,.tgt-team-round strong,.tgt-team-final-kpi strong,.tgt-directory-stat strong,.tgt-final-flow-card strong,.tgt-marker-kpi strong,.tgt-course-db-count strong,.tgt-tee-grid article strong{color:#0b6543!important}
        .tgt-player-result strong,.final-score,.tgt-public-live-top-five-row>span:nth-last-child(2),.tgt-marker-top-five-row>span:nth-last-child(2){color:#0b6543!important}
        .tgt-ops-shell>.marker-card,.tgt-player-home{border-color:rgba(255,255,255,.22)!important}
        .tgt-ops-shell .marker-header,.tgt-marker-live-header,.tgt-marker-top-five-card>header,.tgt-marker-live-table thead{border-color:rgba(255,255,255,.16)!important;color:#fff!important;background:linear-gradient(135deg,#075238,#0a6845)!important}
        .tgt-ops-shell .logout-button,.tgt-marker-live-back,.tgt-marker-live-refresh{border-color:rgba(255,255,255,.34)!important;color:#fff!important;background:rgba(255,255,255,.12)!important}
        .tgt-marker-live-toggle button.active,.tgt-course-list button.active{border-color:#168454!important;color:#fff!important;background:#168454!important}
        .tgt-marker-live-table th{color:#fff!important;border-bottom-color:rgba(255,255,255,.18)!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1,.tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1 span{color:#fff!important;background:none!important;-webkit-text-fill-color:#fff!important;filter:none!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-kicker{border-color:rgba(255,255,255,.38)!important;color:#fff!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-primary-action{border-color:#fff!important;color:#fff!important;background:#168454!important}
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.20)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(238,250,242,.72)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(255,255,255,.14)!important}.tgt-fixed-play-disc{border-color:#fff!important;color:#fff!important;background:linear-gradient(145deg,#ef5a61,#c9323a)!important}
`}</style>
  </main>;
}

function PlayerDashboard({ session, onLogout, onStartScoring, onNavigate, initialMenuOpen = false, onProfileResolved }) {
  const [profile,setProfile]=useState(null); const [results,setResults]=useState([]); const [playerStats,setPlayerStats]=useState({ holes:0, eagles:0, birdies:0, pars:0, bogeys:0, doublePlus:0, grossAverage:null }); const [position,setPosition]=useState(null); const [seasonScore,setSeasonScore]=useState(null); const [hcpDraft,setHcpDraft]=useState(""); const [editingHcp,setEditingHcp]=useState(false); const [savingHcp,setSavingHcp]=useState(false); const [message,setMessage]=useState(""); const [errorMessage,setErrorMessage]=useState(""); const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;
    async function load(){
      setLoading(true);
      setErrorMessage("");
      const email=String(session.user.email??"").trim().toLowerCase();
      const loginKey=email.split("@")[0].replace(/[^a-z0-9æøå]/gi,"").toLocaleLowerCase("da");
      const normalizeIdentity=(value)=>String(value??"").trim().toLocaleLowerCase("da").replace(/@.*$/,"").replace(/[^a-z0-9æøå]/gi,"");

      // Find the authenticated player directly, without an embedded season join.
      // Exact e-mail is the primary link. Name/username is only a safe fallback.
      let playerRows=[];
      const exactResult=await supabase
        .from("players")
        .select("id,name,email,handicap_index,dgu_number,club_name,tournament_id,active")
        .ilike("email",email);
      if(!active)return;
      if(exactResult.error){setErrorMessage(exactResult.error.message);setLoading(false);return;}
      playerRows=exactResult.data??[];

      if(playerRows.length===0){
        const fallbackResult=await supabase
          .from("players")
          .select("id,name,email,handicap_index,dgu_number,club_name,tournament_id,active");
        if(!active)return;
        if(fallbackResult.error){setErrorMessage(fallbackResult.error.message);setLoading(false);return;}
        playerRows=(fallbackResult.data??[]).filter((player)=>
          normalizeIdentity(player.email)===loginKey||normalizeIdentity(player.name)===loginKey
        );
      }

      const tournamentIds=[...new Set(playerRows.map((player)=>player.tournament_id).filter(Boolean))];
      let tournamentById=new Map();
      if(tournamentIds.length){
        const tournamentResult=await supabase
          .from("tournaments")
          .select("id,season")
          .in("id",tournamentIds);
        if(!active)return;
        if(tournamentResult.error){setErrorMessage(tournamentResult.error.message);setLoading(false);return;}
        tournamentById=new Map((tournamentResult.data??[]).map((item)=>[String(item.id),item]));
      }

      let all=playerRows.map((player)=>({...player,tournaments:tournamentById.get(String(player.tournament_id))??null}));

      // Some production RLS policies do not expose rows from players to a normal
      // authenticated player. The public 2027 standings already expose the safe
      // player id/name pair, so use that as a deterministic fallback for login.
      // This keeps SPIL connected to the real 2027 player id.
      if(!all.some((player)=>Number(player.tournaments?.season)===ACTIVE_SEASON)){
        const standingsResult=await supabase
          .from("season_individual_standings")
          .select("player_id,player_name,season")
          .eq("season",ACTIVE_SEASON);
        if(!active)return;
        if(standingsResult.error){setErrorMessage(standingsResult.error.message);setLoading(false);return;}
        const standing=(standingsResult.data??[]).find((player)=>
          normalizeIdentity(player.player_name)===loginKey
        );
        if(standing){
          all=[{
            id:standing.player_id,
            name:standing.player_name,
            email,
            handicap_index:null,
            dgu_number:null,
            club_name:null,
            tournament_id:null,
            active:true,
            tournaments:{season:ACTIVE_SEASON},
          },...all];
        }
      }
      const newest=all.find((player)=>Number(player.tournaments?.season)===ACTIVE_SEASON)??null;
      const profileWithGolfData=newest?{
        ...newest,
        dgu_number:newest.dgu_number??all.find((player)=>player.dgu_number)?.dgu_number??null,
        club_name:newest.club_name??all.find((player)=>player.club_name)?.club_name??null,
      }:null;
      setProfile(profileWithGolfData);
      if(profileWithGolfData&&onProfileResolved)onProfileResolved(profileWithGolfData.id);
      setHcpDraft(newest?.handicap_index??"");
      if(!newest){setLoading(false);return;}

      const activePlayerIds=[newest.id];
      const [rr,sr,scoreResult]=await Promise.all([
        supabase.from("round_results").select("player_id,round_number,score,tournaments!inner(season)").in("player_id",activePlayerIds).eq("tournaments.season",ACTIVE_SEASON).not("score","is",null),
        supabase.from("season_individual_standings").select("player_id,player_name,counting_score,counting_rounds").eq("season",ACTIVE_SEASON),
        supabase.from("scores").select("player_id,round_id,hole_number,strokes,rounds!inner(course_id,tournaments!inner(season))").in("player_id",activePlayerIds).eq("rounds.tournaments.season",ACTIVE_SEASON).not("strokes","is",null),
      ]);
      if(!active)return;
      if(rr.error)setErrorMessage(rr.error.message);else setResults(rr.data??[]);
      if(!scoreResult.error){
        const scoreRows=scoreResult.data??[];
        const courseIds=[...new Set(scoreRows.map((row)=>row.rounds?.course_id).filter(Boolean))];
        let holeRows=[];
        if(courseIds.length){
          const holeResult=await supabase.from("course_holes").select("course_id,hole_number,par").in("course_id",courseIds);
          if(!holeResult.error)holeRows=holeResult.data??[];
        }
        if(!active)return;
        const parMap=new Map(holeRows.map((hole)=>[`${hole.course_id}-${hole.hole_number}`,Number(hole.par)]));
        const stats=scoreRows.reduce((acc,row)=>{
          const par=parMap.get(`${row.rounds?.course_id}-${row.hole_number}`);
          const strokes=Number(row.strokes);
          if(!Number.isFinite(par)||!Number.isFinite(strokes))return acc;
          const toPar=strokes-par;
          acc.holes+=1;acc.grossTotal+=strokes;
          if(toPar<=-2)acc.eagles+=1;else if(toPar===-1)acc.birdies+=1;else if(toPar===0)acc.pars+=1;else if(toPar===1)acc.bogeys+=1;else acc.doublePlus+=1;
          return acc;
        },{holes:0,grossTotal:0,eagles:0,birdies:0,pars:0,bogeys:0,doublePlus:0});
        setPlayerStats({...stats,grossAverage:stats.holes?stats.grossTotal/stats.holes:null});
      }
      if(!sr.error){
        const sorted=sortStandings(sr.data??[]);
        const i=sorted.findIndex((item)=>String(item.player_id)===String(newest.id));
        setPosition(i>=0?i+1:null);
        setSeasonScore(i>=0?sorted[i].counting_score:null);
      }
      setLoading(false);
    }
    load();
    return()=>{active=false};
  },[session.user.email]);
  async function saveHandicap(){const value=Number(String(hcpDraft).replace(",","."));if(!Number.isFinite(value)||value<-10||value>54){setErrorMessage("Handicap skal være mellem -10 og 54.");return;}setSavingHcp(true);setErrorMessage("");setMessage("");const {error}=await supabase.from("players").update({handicap_index:value}).eq("id",profile.id);setSavingHcp(false);if(error){setErrorMessage(error.message);return;}setProfile(current=>({...current,handicap_index:value}));setHcpDraft(value);setEditingHcp(false);setMessage("Dit handicap er opdateret.");}
  const dguNumber = profile?.dgu_number ?? profile?.dguNumber ?? session.user.user_metadata?.dgu_number ?? session.user.user_metadata?.dguNumber ?? "Ikke angivet";
  const clubName = profile?.club_name ?? profile?.clubName ?? session.user.user_metadata?.club_name ?? session.user.user_metadata?.clubName ?? "Ikke angivet";
  const latest=[...results].sort((a,b)=>Number(b.tournaments?.season??0)-Number(a.tournaments?.season??0)||Number(b.round_number??0)-Number(a.round_number??0)).slice(0,8);
  return <main className="tgt-player-shell"><style>{`.tgt-player-shell{min-height:100dvh;padding:clamp(12px,4vw,46px);padding-bottom:calc(112px + env(safe-area-inset-bottom));background:radial-gradient(circle at 12% 4%,rgba(22,132,84,.15),transparent 27%),linear-gradient(155deg,#031f17,#073727 48%,#0a4935)}
        .tgt-player-shell .tgt-mobile-bottom-nav{position:fixed!important;left:0!important;right:0!important;bottom:0!important;z-index:120!important;width:100%!important;max-width:none!important;height:calc(64px + env(safe-area-inset-bottom))!important;min-height:64px!important;display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;grid-template-rows:56px!important;align-items:center!important;margin:0!important;padding:4px 8px calc(4px + env(safe-area-inset-bottom))!important;transform:none!important;border:0!important;border-top:1px solid rgba(255,255,255,.26)!important;border-radius:0!important;background:rgba(4,37,27,.985)!important;box-shadow:0 -10px 30px rgba(2,24,17,.22)!important;backdrop-filter:blur(18px)!important;overflow:visible!important}
        .tgt-player-shell .tgt-mobile-bottom-nav button{position:relative!important;width:100%!important;min-width:0!important;max-width:none!important;height:50px!important;min-height:50px!important;display:grid!important;place-items:center!important;margin:0!important;padding:0!important;border:0!important;border-radius:12px!important;background:transparent!important;color:rgba(255,255,255,.62)!important;cursor:pointer!important}
        .tgt-player-shell .tgt-mobile-bottom-nav button.active{color:#ffffff!important;background:rgba(255,255,255,.08)!important}
        .tgt-player-shell .tgt-mobile-bottom-nav button>span:not(.tgt-bottom-play-icon){width:24px!important;height:24px!important;display:grid!important;place-items:center!important;font-size:21px!important;line-height:1!important}
        .tgt-player-shell .tgt-mobile-bottom-nav button small{display:none!important;width:0!important;height:0!important;margin:0!important;padding:0!important;overflow:hidden!important}
        .tgt-player-shell .tgt-mobile-bottom-nav .tgt-bottom-play{width:58px!important;min-width:58px!important;max-width:58px!important;height:58px!important;min-height:58px!important;justify-self:center!important;align-self:center!important;margin:-18px auto 0!important;padding:0!important;border-radius:50%!important;background:transparent!important}
        .tgt-player-shell .tgt-bottom-play-icon{width:54px!important;height:54px!important;display:grid!important;place-items:center!important;border:2px solid #ffffff!important;border-radius:50%!important;background:linear-gradient(145deg,#39a86f,#08794c)!important;box-shadow:0 7px 19px rgba(0,0,0,.28),0 0 0 4px rgba(4,37,27,.985)!important;font-size:23px!important;line-height:1!important}
        .tgt-player-shell .tgt-mobile-bottom-nav .tgt-bottom-play small{display:none!important}.tgt-player-home{width:min(1120px,100%);margin:auto;overflow:hidden;border:1px solid rgba(255,255,255,.42);border-radius:24px;background:#f7faf7;box-shadow:0 28px 80px rgba(0,0,0,.28)}.tgt-player-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:clamp(18px,3vw,28px);color:#ffffff;background:linear-gradient(135deg,#04251b,#0a4935)}.tgt-player-head h1{margin:5px 0;color:#ffffff!important;font-family:Georgia,serif;font-size:clamp(29px,4.5vw,43px)}.tgt-player-meta{display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin-top:7px;color:#e7cf8c;font-size:13px;font-weight:750}.tgt-player-meta span{display:inline-flex;align-items:center;gap:5px}.tgt-player-actions{display:flex;gap:9px;flex-wrap:wrap}.tgt-player-actions button{min-height:44px;padding:0 16px;border:1px solid rgba(255,255,255,.45);border-radius:999px;color:#ffffff;background:rgba(2,27,20,.48);font-weight:900}.tgt-player-content{padding:clamp(14px,3vw,26px)}.tgt-player-intro{display:flex;align-items:center;gap:16px}.tgt-player-avatar{width:52px;height:52px;min-width:52px;display:grid;place-items:center;border-radius:50%;background:linear-gradient(135deg,#39a86f,#08794c);color:#123629;font:900 21px Georgia}.tgt-player-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:13px 0 16px}.tgt-player-kpi,.tgt-player-panel{padding:13px;border:1px solid rgba(25,65,48,.12);border-radius:18px;background:#ffffff}.tgt-player-kpi span{display:block;color:#78827d;font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.tgt-player-kpi strong{display:block;margin-top:5px;color:#164432;font-size:21px}.tgt-player-grid{display:grid;grid-template-columns:1.35fr .65fr;gap:16px;align-items:start}.tgt-player-intro h2{color:#173d2e}.tgt-player-intro span{color:#78827d}.tgt-player-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.tgt-player-stat{min-height:78px;padding:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;border:1px solid rgba(22,132,84,.26);border-radius:13px;background:#eff7f2;text-align:center}.tgt-player-stat strong{color:#164432;font-size:21px}.tgt-player-stat small{color:#78827d;font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.tgt-player-result{display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid #e1e8e3}.tgt-player-result strong{color:#0b6543}.tgt-hcp-link{width:30px;height:30px;display:inline-grid;place-items:center;margin:7px auto 0;padding:0;border:1px solid rgba(165,117,37,.38);border-radius:50%;background:#eff7f2;color:#0b6543;font-size:14px;line-height:1;cursor:pointer}.tgt-hcp-link:hover{background:#e1eee6}.tgt-player-primary{width:100%;min-height:50px;margin:12px 0 3px;border:1px solid #168454;border-radius:14px;color:#ffffff;background:linear-gradient(145deg,#073727,#0a4935);font-size:16px;font-weight:900;cursor:pointer;box-shadow:0 10px 24px rgba(3,31,23,.14)}.tgt-hcp-edit{display:grid;grid-template-columns:1fr auto auto;gap:8px;margin-top:12px}.tgt-hcp-edit input{min-width:0;padding:11px;border:1px solid #cad5cc;border-radius:10px}.tgt-hcp-edit button{padding:0 13px;border-radius:10px;border:1px solid #168454;font-weight:900}.tgt-hcp-save{background:#073727;color:#ffffff}.tgt-coming article{padding:14px;margin-top:9px;border-radius:13px;background:#eff7f2}.tgt-player-start{width:100%;min-height:54px;margin-top:9px;border:1px solid #168454;border-radius:13px;color:#ffffff;background:linear-gradient(145deg,#073727,#0a4935);font-size:16px;font-weight:900;cursor:pointer}.tgt-coming small{display:block;margin-top:4px;color:#78827d}@media(max-width:820px){.tgt-player-stat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.tgt-player-kpis{grid-template-columns:repeat(2,1fr)}.tgt-player-grid{grid-template-columns:1fr}}@media(max-width:600px){.tgt-player-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tgt-player-shell{padding:0}.tgt-player-home{min-height:100dvh;border:0;border-radius:0}.tgt-player-head{align-items:flex-start;flex-direction:column;padding:18px 16px}.tgt-player-actions{width:100%}.tgt-player-actions button{flex:1}.tgt-player-content{padding:12px 10px 24px}.tgt-player-avatar{width:50px;height:50px;min-width:50px}.tgt-player-kpis{gap:8px;margin:12px 0 16px}.tgt-player-kpi{padding:11px;min-height:82px}.tgt-player-kpi strong{font-size:19px}.tgt-player-grid{grid-template-columns:1fr}.tgt-hcp-edit{grid-template-columns:1fr 1fr}.tgt-hcp-edit input{grid-column:1/-1}}
        @media(min-width:601px){
          .tgt-player-shell{padding:20px 14px calc(90px + env(safe-area-inset-bottom))!important}
          .tgt-player-home{width:min(860px,100%)!important}
          .tgt-player-head{padding:22px 20px!important}
          .tgt-player-content{padding:18px 16px 34px!important}
          .tgt-player-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}
          .tgt-player-grid{grid-template-columns:1fr!important}
          .tgt-player-stat-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
          .tgt-player-shell .tgt-mobile-bottom-nav{left:50%!important;right:auto!important;width:min(860px,100%)!important;transform:translateX(-50%)!important}
        }
        /* Final premium bottom-navigation override */
        .tgt-mit-tgt-universe{padding-bottom:calc(112px + env(safe-area-inset-bottom))!important}
        .tgt-mit-tgt-universe .main-content{padding-bottom:42px!important;scroll-margin-bottom:120px!important}
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav,
        .tgt-player-shell .tgt-mobile-bottom-nav{
          position:fixed!important;left:50%!important;right:auto!important;bottom:max(10px,env(safe-area-inset-bottom))!important;z-index:9999!important;
          width:min(620px,calc(100% - 24px))!important;height:68px!important;min-height:68px!important;
          display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;grid-template-rows:68px!important;align-items:center!important;
          padding:6px 10px!important;margin:0!important;transform:translateX(-50%)!important;
          border:1px solid rgba(255,255,255,.30)!important;border-radius:24px!important;
          background:linear-gradient(180deg,rgba(8,55,40,.96),rgba(3,34,25,.98))!important;
          box-shadow:0 18px 46px rgba(0,24,17,.34),inset 0 1px 0 rgba(255,255,255,.08)!important;
          backdrop-filter:blur(20px) saturate(130%)!important;-webkit-backdrop-filter:blur(20px) saturate(130%)!important;
          overflow:visible!important;box-sizing:border-box!important
        }
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav button,
        .tgt-player-shell .tgt-mobile-bottom-nav button{
          position:relative!important;width:100%!important;height:52px!important;min-width:0!important;min-height:52px!important;
          display:grid!important;place-items:center!important;margin:0!important;padding:0!important;border:0!important;border-radius:17px!important;
          background:transparent!important;color:rgba(255,255,255,.66)!important;box-shadow:none!important;
          transition:background .18s ease,color .18s ease,transform .18s ease!important
        }
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav button:active,
        .tgt-player-shell .tgt-mobile-bottom-nav button:active{transform:scale(.94)!important}
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav button.active,
        .tgt-player-shell .tgt-mobile-bottom-nav button.active{color:#ffffff!important;background:rgba(255,255,255,.10)!important}
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav button.active:after,
        .tgt-player-shell .tgt-mobile-bottom-nav button.active:after{content:""!important;position:absolute!important;left:50%!important;bottom:4px!important;width:4px!important;height:4px!important;transform:translateX(-50%)!important;border-radius:50%!important;background:#ffffff!important;box-shadow:0 0 12px rgba(255,255,255,.75)!important}
        .tgt-mit-tgt-universe .tgt-nav-glyph,.tgt-player-shell .tgt-nav-glyph{width:23px!important;height:23px!important;opacity:.96!important}
        .tgt-mit-tgt-universe .tgt-mobile-bottom-nav .tgt-bottom-play,
        .tgt-player-shell .tgt-mobile-bottom-nav .tgt-bottom-play{width:64px!important;min-width:64px!important;max-width:64px!important;height:64px!important;min-height:64px!important;justify-self:center!important;align-self:center!important;margin:-22px auto 0!important;border-radius:50%!important;background:transparent!important}
        .tgt-mit-tgt-universe .tgt-bottom-play-icon,.tgt-player-shell .tgt-bottom-play-icon{width:60px!important;height:60px!important;display:grid!important;place-items:center!important;transform:none!important;border:2px solid rgba(255,255,255,.92)!important;border-radius:50%!important;color:#073326!important;background:linear-gradient(145deg,#ffffff 0%,#39a86f 48%,#08794c 100%)!important;box-shadow:0 12px 28px rgba(0,0,0,.34),0 0 0 5px rgba(5,42,31,.94),inset 0 1px 0 rgba(255,255,255,.55)!important;font-size:11px!important;font-weight:1000!important;letter-spacing:.10em!important}
        .tgt-player-shell{padding-bottom:calc(112px + env(safe-area-inset-bottom))!important}
        .tgt-player-shell .tgt-player-content{padding-bottom:44px!important;scroll-margin-bottom:120px!important}
        @media(max-width:700px){
          .tgt-mit-tgt-universe,.tgt-player-shell{padding-bottom:calc(108px + env(safe-area-inset-bottom))!important}
          .tgt-mit-tgt-universe .tgt-mobile-bottom-nav,.tgt-player-shell .tgt-mobile-bottom-nav{bottom:max(8px,env(safe-area-inset-bottom))!important;width:calc(100% - 20px)!important;border-radius:22px!important}
        }

        /* Unified Mit TGT profile shell */
        .tgt-player-home{max-width:860px!important;border-radius:26px!important}
        .tgt-player-appbar{position:sticky;top:0;z-index:90;min-height:64px;display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid rgba(255,255,255,.20);color:#ffffff;background:rgba(3,39,28,.97);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
        .tgt-player-brand{display:flex;align-items:center;gap:10px}.tgt-player-brandmark{width:40px;height:40px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.68);border-radius:50%;font:900 14px Georgia;color:#ffffff}.tgt-player-brand strong{display:block;font-size:11px;letter-spacing:.16em}.tgt-player-brand small{display:block;margin-top:3px;color:rgba(255,255,255,.58);font-size:8px;letter-spacing:.10em}.tgt-player-menu-button{width:42px!important;height:42px!important;min-width:42px!important;display:grid!important;place-items:center!important;padding:0!important;border:1px solid rgba(255,255,255,.30)!important;border-radius:50%!important;color:#ffffff!important;background:rgba(255,255,255,.035)!important}
        .tgt-player-head{padding:30px 24px 28px!important}.tgt-player-head h1{font-size:clamp(34px,6vw,52px)!important}.tgt-player-content{background:linear-gradient(180deg,#f7faf7,#eef5f0)!important}.tgt-player-primary{border-radius:999px!important;box-shadow:0 10px 22px rgba(4,47,34,.16)!important}.tgt-player-kpi,.tgt-player-panel{border-radius:20px!important;box-shadow:0 8px 24px rgba(12,47,34,.06)!important}
        .tgt-player-shell .tgt-mobile-bottom-nav{grid-template-columns:repeat(5,minmax(0,1fr))!important}
        .tgt-player-shell .tgt-mobile-bottom-nav>button{display:grid!important;visibility:visible!important;opacity:1!important}
        @media(max-width:600px){.tgt-player-home{border-radius:0!important}.tgt-player-head{padding:24px 16px 22px!important}.tgt-player-actions{display:none!important}.tgt-player-content{padding:14px 10px 38px!important}}

        /* Definitive Mit TGT bottom nav. Unique selectors override all legacy nav CSS. */
        .tgt-fixed-bottom-nav{position:fixed!important;left:50%!important;right:auto!important;bottom:max(10px,env(safe-area-inset-bottom))!important;z-index:10000!important;width:min(620px,calc(100% - 20px))!important;height:72px!important;display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;grid-template-rows:72px!important;align-items:center!important;gap:0!important;margin:0!important;padding:7px 10px!important;transform:translateX(-50%)!important;box-sizing:border-box!important;overflow:visible!important;border:1px solid rgba(255,255,255,.34)!important;border-radius:25px!important;background:linear-gradient(180deg,rgba(8,61,43,.98),rgba(3,38,27,.99))!important;box-shadow:0 18px 48px rgba(0,25,18,.38),inset 0 1px 0 rgba(255,255,255,.09)!important;backdrop-filter:blur(20px)!important;-webkit-backdrop-filter:blur(20px)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item{position:relative!important;appearance:none!important;-webkit-appearance:none!important;width:100%!important;height:56px!important;min-width:0!important;min-height:56px!important;max-width:none!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;margin:0!important;padding:0!important;visibility:visible!important;opacity:1!important;overflow:visible!important;border:0!important;border-radius:17px!important;color:rgba(238,250,242,.68)!important;background:transparent!important;box-shadow:none!important;transform:none!important;cursor:pointer!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#ffffff!important;background:rgba(255,255,255,.11)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active:not(.tgt-fixed-nav-play):after{content:""!important;position:absolute!important;left:50%!important;bottom:3px!important;width:4px!important;height:4px!important;transform:translateX(-50%)!important;border-radius:50%!important;background:#ffffff!important;box-shadow:0 0 10px rgba(255,255,255,.8)!important}
        .tgt-fixed-nav-icon{width:23px!important;height:23px!important;display:block!important;visibility:visible!important;opacity:1!important;color:currentColor!important}
        .tgt-fixed-nav-icon svg{width:23px!important;height:23px!important;display:block!important;overflow:visible!important;fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round!important;stroke-linejoin:round!important}
        .tgt-fixed-nav-item small{display:block!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;overflow:visible!important;color:currentColor!important;font-size:8px!important;font-weight:900!important;line-height:1!important;letter-spacing:.05em!important;text-transform:uppercase!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-play{width:64px!important;min-width:64px!important;max-width:64px!important;height:64px!important;min-height:64px!important;justify-self:center!important;align-self:center!important;margin:-25px auto 0!important;border-radius:50%!important;background:transparent!important}
        .tgt-fixed-play-disc{width:60px!important;height:60px!important;display:grid!important;place-items:center!important;visibility:visible!important;opacity:1!important;border:2px solid #ffffff!important;border-radius:50%!important;color:#073326!important;background:linear-gradient(145deg,#eaf5ee 0%,#39a86f 50%,#08794c 100%)!important;box-shadow:0 12px 28px rgba(0,0,0,.36),0 0 0 6px rgba(4,42,31,.98),inset 0 1px 0 rgba(255,255,255,.58)!important;font-size:11px!important;font-weight:1000!important;line-height:1!important;letter-spacing:.10em!important}
        .tgt-fixed-nav-item:active{transform:scale(.94)!important}.tgt-fixed-nav-item:disabled{opacity:.46!important;cursor:not-allowed!important}
        @media(max-width:700px){.tgt-fixed-bottom-nav{bottom:max(8px,env(safe-area-inset-bottom))!important;width:calc(100% - 18px)!important;height:70px!important;grid-template-rows:70px!important;padding:6px 8px!important;border-radius:23px!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item{height:54px!important;min-height:54px!important}.tgt-fixed-nav-item small{font-size:7px!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-play{margin:-23px auto 0!important}}

        /* TGT golf theme: green, black and red. Gold is reserved for Hall of Fame. */
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.12)!important;background:linear-gradient(180deg,rgba(15,20,18,.98),rgba(3,9,7,.99))!important;box-shadow:0 16px 42px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.07)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(234,241,237,.62)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(27,111,70,.30)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active:not(.tgt-fixed-nav-play):after{background:#d8343a!important;box-shadow:0 0 12px rgba(216,52,58,.8)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item:nth-child(4){color:#ef6b70!important}
        .tgt-fixed-play-disc{border-color:#f1f5f2!important;color:#fff!important;background:linear-gradient(145deg,#d9454b,#9f1f25)!important;box-shadow:0 12px 28px rgba(0,0,0,.38),0 0 0 6px rgba(5,24,17,.98),inset 0 1px 0 rgba(255,255,255,.25)!important}
        .tgt-player-appbar{border-bottom-color:rgba(255,255,255,.10)!important;color:#fff!important;background:rgba(5,35,25,.98)!important}
        .tgt-player-brandmark{border-color:rgba(255,255,255,.30)!important;color:#fff!important;background:#07140f!important}
        .tgt-player-brand strong{color:#fff!important}.tgt-player-brand small{color:rgba(226,237,230,.60)!important}
        .tgt-player-menu-button{border-color:rgba(255,255,255,.20)!important;color:#fff!important;background:#07140f!important}
        .tgt-top-menu-svg{width:23px!important;height:23px!important;display:block!important;fill:none!important;stroke:currentColor!important;stroke-width:2!important;stroke-linecap:round!important}
        .tgt-player-head{background:linear-gradient(145deg,#063d2a,#075438)!important;color:#fff!important}
        .tgt-player-head .eyebrow,.tgt-player-head h1,.tgt-player-head span{color:#fff!important}
        .tgt-player-head .tgt-player-actions button{border-color:rgba(255,255,255,.30)!important;color:#fff!important;background:#07140f!important}
        .tgt-player-content{background:#f3f5f3!important}
        .tgt-player-primary{border-color:#0d6843!important;color:#fff!important;background:linear-gradient(135deg,#0b6842,#06442e)!important}
        .tgt-player-kpi,.tgt-player-panel{border-color:#dbe2dd!important;background:#fff!important;box-shadow:0 8px 24px rgba(7,31,22,.07)!important}
        .tgt-player-kpi strong,.tgt-player-panel h2,.tgt-player-panel h3{color:#0a3d2a!important}
        .tgt-player-avatar{color:#fff!important;background:linear-gradient(145deg,#0f754b,#073d2a)!important}
        .tgt-drawer{border-color:rgba(255,255,255,.12)!important;background:#07140f!important;color:#fff!important}
        .tgt-drawer-head{border-bottom-color:rgba(255,255,255,.10)!important}.tgt-drawer-head h2,.tgt-drawer-head .eyebrow{color:#fff!important}
        .tgt-drawer-close{border-color:rgba(255,255,255,.18)!important;color:#fff!important;background:#111a16!important}
        .tgt-drawer-nav button{border-color:rgba(255,255,255,.09)!important;color:#eef4f0!important;background:#0b2419!important}
        .tgt-drawer-nav button:hover{background:#103522!important}
        .tgt-hall-fullscreen,.tgt-hall-panel,.tgt-hall-card{--hall-gold:#d6b25e}

        /* Fresh golf theme: inviting fairway greens with restrained coral-red energy. Hall of Fame keeps its own gold styling. */
        :root{--tgt-forest:#073f2c;--tgt-deep:#052f22;--tgt-fairway:#168454;--tgt-fairway-light:#39a86f;--tgt-mint:#eaf5ee;--tgt-paper:#f7faf7;--tgt-white:#ffffff;--tgt-red:#df454d;--tgt-red-dark:#b92f37;--tgt-ink:#113c2d;--tgt-muted:#688077}
        .tgt-public-shell,.tgt-player-shell{background:linear-gradient(180deg,#dff0e5 0%,#f7faf7 30%,#eef5f0 100%)!important;color:var(--tgt-ink)!important}
        .tgt-public-topbar,.tgt-player-appbar{border-bottom:1px solid rgba(255,255,255,.18)!important;background:linear-gradient(135deg,#075238,#0a6845)!important;color:#fff!important;box-shadow:0 8px 24px rgba(7,63,44,.14)!important}
        .tgt-wordmark-mark,.tgt-player-brandmark{border-color:rgba(255,255,255,.48)!important;color:#fff!important;background:rgba(255,255,255,.10)!important}
        .tgt-wordmark strong,.tgt-player-brand strong{color:#fff!important}.tgt-wordmark small,.tgt-player-brand small{color:rgba(255,255,255,.72)!important}
        .tgt-menu-button,.tgt-player-menu-button{border-color:rgba(255,255,255,.34)!important;color:#fff!important;background:rgba(255,255,255,.12)!important;box-shadow:none!important}
        .tgt-premium-hero,.tgt-player-head{background:linear-gradient(145deg,#086844 0%,#0e8654 62%,#167348 100%)!important;color:#fff!important}
        .tgt-premium-hero:before,.tgt-player-head:before{background:radial-gradient(circle at 82% 20%,rgba(255,255,255,.15),transparent 30%)!important}
        .tgt-premium-hero h1,.tgt-player-head h1,.tgt-premium-hero .eyebrow,.tgt-player-head .eyebrow,.tgt-player-head span{color:#fff!important}
        .tgt-player-content,.main-content,.tgt-app-lobby{background:transparent!important}
        .leaderboard-card,.tgt-player-kpi,.tgt-player-panel,.tgt-lobby-grid button,.tgt-round-card,.tgt-live-card{border-color:#d7e6dc!important;background:rgba(255,255,255,.94)!important;box-shadow:0 10px 28px rgba(7,63,44,.08)!important}
        .leaderboard-card h2,.leaderboard-card h3,.tgt-player-kpi strong,.tgt-player-panel h2,.tgt-player-panel h3,.tgt-lobby-grid strong{color:var(--tgt-ink)!important}
        .eyebrow:not(.tgt-hall-fullscreen .eyebrow):not(.tgt-hall-panel .eyebrow){color:var(--tgt-fairway)!important}
        .tgt-player-avatar{color:#fff!important;background:linear-gradient(145deg,#27a467,#08794c)!important;box-shadow:0 8px 18px rgba(22,132,84,.22)!important}
        .tgt-player-primary,.login-submit-button,.tgt-primary-action{border-color:#0d7b4e!important;color:#fff!important;background:linear-gradient(135deg,#1b985f,#0c7048)!important;box-shadow:0 10px 22px rgba(22,132,84,.20)!important}
        .tgt-player-primary:hover,.login-submit-button:hover,.tgt-primary-action:hover{background:linear-gradient(135deg,#20a768,#0e7b4f)!important}
        .tgt-secondary-action,.login-cancel-button{border-color:#bcd6c5!important;color:#0b6543!important;background:#fff!important}
        .tgt-tabs button.active,.tgt-tab.active,.tgt-filter-button.active{border-color:#168454!important;color:#fff!important;background:#168454!important}
        .live-badge,.tgt-live-badge{border-color:rgba(223,69,77,.28)!important;color:#fff!important;background:var(--tgt-red)!important}
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.22)!important;background:linear-gradient(180deg,rgba(8,91,59,.99),rgba(5,65,45,.99))!important;box-shadow:0 16px 42px rgba(7,63,44,.30),inset 0 1px 0 rgba(255,255,255,.14)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(238,250,242,.72)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(255,255,255,.14)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active:not(.tgt-fixed-nav-play):after{background:var(--tgt-red)!important;box-shadow:0 0 12px rgba(223,69,77,.75)!important}
        .tgt-fixed-bottom-nav .tgt-fixed-nav-item:nth-child(4){color:#ffd9db!important}
        .tgt-fixed-play-disc{border-color:#fff!important;color:#fff!important;background:linear-gradient(145deg,#ef5a61,#c9323a)!important;box-shadow:0 12px 27px rgba(95,22,27,.28),0 0 0 6px rgba(7,86,56,.98),inset 0 1px 0 rgba(255,255,255,.30)!important}
        .tgt-drawer{border-color:rgba(255,255,255,.18)!important;background:linear-gradient(160deg,#07543a,#0b7049)!important;color:#fff!important}
        .tgt-drawer-head{border-bottom-color:rgba(255,255,255,.15)!important}.tgt-drawer-head h2,.tgt-drawer-head .eyebrow{color:#fff!important}
        .tgt-drawer-close{border-color:rgba(255,255,255,.28)!important;color:#fff!important;background:rgba(255,255,255,.12)!important}
        .tgt-drawer-nav button{border-color:rgba(255,255,255,.12)!important;color:#fff!important;background:rgba(255,255,255,.09)!important}
        .tgt-drawer-nav button:hover{background:rgba(255,255,255,.16)!important}
        .status-box{border-color:#d3e6da!important;color:#45685a!important;background:#eff7f2!important}
        .tgt-player-stat{background:#eff7f2!important}.tgt-player-stat strong{color:#08764a!important}
        .tgt-hall-fullscreen,.tgt-hall-panel,.tgt-hall-card{--hall-gold:#d6b25e}

/* Final anti-gold pass outside Hall of Fame */
.tgt-public-topbar,.tgt-player-appbar,.tgt-mit-tgt-universe{--tgt-gold-replacement:#ffffff}
.tgt-public-topbar *, .tgt-player-appbar *, .tgt-mit-tgt-universe .eyebrow, .tgt-mit-tgt-universe h1, .tgt-mit-tgt-universe h2, .tgt-mit-tgt-universe h3 {color:inherit}
.tgt-mit-tgt-universe .tgt-wordmark, .tgt-mit-tgt-universe .tgt-public-login-choice, .tgt-mit-tgt-universe .tgt-score-label, .tgt-mit-tgt-universe .position-1, .tgt-mit-tgt-universe .position-2, .tgt-mit-tgt-universe .position-3 {color:#113c2d!important}
.tgt-mit-tgt-universe .position-badge{background:#eaf5ee!important;color:#0b6543!important}
.tgt-mit-tgt-universe .position-1,.tgt-mit-tgt-universe .position-2,.tgt-mit-tgt-universe .position-3{background:#eaf5ee!important}

        /* FINAL AUTHENTICATED UI: no burger, no gold, fixed nav, full scroll room */
        .tgt-mit-tgt-universe,.tgt-player-shell,.tgt-menu-page{padding-bottom:calc(132px + env(safe-area-inset-bottom))!important}
        .tgt-mit-tgt-universe .main-content,.tgt-player-shell .tgt-player-content,.tgt-menu-page-shell{padding-bottom:64px!important;scroll-margin-bottom:140px!important}
        .tgt-mit-tgt-universe .tgt-public-login-choice,.tgt-mit-tgt-universe .tgt-menu-button,.tgt-player-menu-button{display:none!important}
        .tgt-mit-tgt-universe .tgt-public-topbar{justify-content:flex-start!important;background:linear-gradient(135deg,#075238,#0a6845)!important}
        .tgt-mit-tgt-universe .tgt-public-topbar:after{content:"MIT TGT"!important;left:auto!important;right:16px!important;transform:none!important;color:#fff!important;font:900 10px/1 system-ui,sans-serif!important;letter-spacing:.16em!important}
        .tgt-mit-tgt-universe .tgt-wordmark,.tgt-mit-tgt-universe .tgt-wordmark *,.tgt-player-appbar,.tgt-player-appbar *{color:#fff!important}
        .tgt-mit-tgt-universe .tgt-wordmark-mark,.tgt-player-brandmark{border-color:rgba(255,255,255,.46)!important;color:#fff!important;background:rgba(255,255,255,.10)!important}
        .tgt-mit-tgt-universe .eyebrow:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-player-shell .eyebrow{color:#168454!important}
        .tgt-mit-tgt-universe h1:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-mit-tgt-universe h2:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-mit-tgt-universe h3:not(.tgt-hall-fullscreen *):not(.tgt-hall-panel *):not(.tgt-hall-card *),.tgt-player-shell h1,.tgt-player-shell h2,.tgt-player-shell h3{color:#113c2d!important}
        .tgt-player-head h1,.tgt-player-head h2,.tgt-player-head h3,.tgt-player-head p,.tgt-player-head span,.tgt-player-head .eyebrow,.tgt-menu-page-head h1,.tgt-menu-page-head p,.tgt-menu-page-head span{color:#fff!important}
        .tgt-mit-tgt-universe th,.tgt-mit-tgt-universe td,.tgt-mit-tgt-universe .player-name,.tgt-mit-tgt-universe .score,.tgt-mit-tgt-universe .score-value,.tgt-player-shell .player-name{color:#113c2d!important}
        .tgt-mit-tgt-universe .waiting,.tgt-mit-tgt-universe .pending,.tgt-mit-tgt-universe [class*="await"]{color:#688077!important}
        .tgt-mit-tgt-universe .tgt-tabs button,.tgt-mit-tgt-universe .tgt-tab,.tgt-mit-tgt-universe .tgt-filter-button{color:#0b6543!important;background:#fff!important;border-color:#c8ddd0!important}
        .tgt-mit-tgt-universe .tgt-tabs button.active,.tgt-mit-tgt-universe .tgt-tab.active,.tgt-mit-tgt-universe .tgt-filter-button.active{color:#fff!important;background:#168454!important;border-color:#168454!important}
        .tgt-mit-tgt-universe .live-badge,.tgt-mit-tgt-universe .tgt-live-badge{color:#fff!important;background:#df454d!important;border-color:#df454d!important}
        /* Classic podium palette remains visible */
        .tgt-mit-tgt-universe .position-badge.position-1,.tgt-mit-tgt-universe .position-1{color:#0b6543!important;background:#eaf5ee!important;border-color:#bcd6c5!important}
        .tgt-mit-tgt-universe .position-badge.position-2,.tgt-mit-tgt-universe .position-2{color:#33424b!important;background:#d9e0e4!important;border-color:#c4ced3!important}
        .tgt-mit-tgt-universe .position-badge.position-3,.tgt-mit-tgt-universe .position-3{color:#5c3214!important;background:#dca56f!important;border-color:#c98e54!important}
        .tgt-fixed-bottom-nav{bottom:max(10px,env(safe-area-inset-bottom))!important}
        @media(max-width:700px){
          .tgt-mit-tgt-universe,.tgt-player-shell,.tgt-menu-page{padding-bottom:calc(128px + env(safe-area-inset-bottom))!important}
          .tgt-mit-tgt-universe .main-content,.tgt-player-shell .tgt-player-content,.tgt-menu-page-shell{padding-bottom:68px!important}
          .tgt-mit-tgt-universe .tgt-public-topbar:after{right:12px!important}
          .tgt-fixed-bottom-nav{bottom:max(8px,env(safe-area-inset-bottom))!important}
        }

        /* Final release logo and compact-copy pass */
        .tgt-wordmark-mark,.tgt-player-brandmark{border-color:rgba(255,255,255,.58)!important;color:#fff!important;background:#0b7049!important;text-shadow:none!important}
        .tgt-wordmark,.tgt-wordmark>span,.tgt-wordmark small,.tgt-player-brand,.tgt-player-brand strong,.tgt-player-brand small{color:#fff!important;text-shadow:none!important}
        .tgt-public-topbar .tgt-wordmark>span:last-child{color:#fff!important}
        .tgt-public-topbar .tgt-wordmark small{color:rgba(255,255,255,.72)!important}
        .tgt-mit-tgt-universe .leaderboard-card>.card-header .description{display:none!important}

        /* Release rule: menu-driven navigation and zero gold outside Hall of Fame */
        .tgt-individual-back-button,.tgt-team-back-button,.tgt-live-back-button,.tgt-panel-back-button{display:none!important}
        .tgt-player-shell,.tgt-public-shell,.tgt-menu-page,.tgt-ops-shell{--tgt-accent:#168454;--tgt-accent-light:#eaf5ee;--tgt-ink:#113c2d}
        .tgt-player-shell .eyebrow,.tgt-ops-shell .eyebrow,.tgt-menu-page .eyebrow{color:#168454!important}
        .tgt-player-head .eyebrow,.tgt-player-head h1,.tgt-player-head span,.tgt-marker-live-header,.marker-header h1,.marker-header .eyebrow{color:#fff!important}
        .tgt-player-avatar,.tgt-team-avatar{color:#fff!important;background:linear-gradient(145deg,#27a467,#08794c)!important;border-color:#fff!important;box-shadow:none!important}
        .tgt-player-kpi,.tgt-player-panel,.tgt-player-stat,.tgt-team-profile,.tgt-team-round,.tgt-team-final-kpi,.tgt-profile-directory-card,.tgt-directory-stat,.tgt-final-flow-card,.tgt-marker-kpi,.tgt-course-db-count,.tgt-tee-grid article{border-color:#d7e6dc!important;color:#113c2d!important;background:#fff!important;box-shadow:0 8px 22px rgba(7,63,44,.07)!important}
        .tgt-player-kpi span,.tgt-player-stat small,.tgt-team-round span,.tgt-directory-stat small,.tgt-final-flow-card span,.tgt-marker-kpi span,.tgt-course-db-count span,.tgt-tee-grid article span,.tgt-tee-grid article small{color:#688077!important}
        .tgt-player-kpi strong,.tgt-player-stat strong,.tgt-team-round strong,.tgt-team-final-kpi strong,.tgt-directory-stat strong,.tgt-final-flow-card strong,.tgt-marker-kpi strong,.tgt-course-db-count strong,.tgt-tee-grid article strong{color:#0b6543!important}
        .tgt-player-result strong,.final-score,.tgt-public-live-top-five-row>span:nth-last-child(2),.tgt-marker-top-five-row>span:nth-last-child(2){color:#0b6543!important}
        .tgt-ops-shell>.marker-card,.tgt-player-home{border-color:rgba(255,255,255,.22)!important}
        .tgt-ops-shell .marker-header,.tgt-marker-live-header,.tgt-marker-top-five-card>header,.tgt-marker-live-table thead{border-color:rgba(255,255,255,.16)!important;color:#fff!important;background:linear-gradient(135deg,#075238,#0a6845)!important}
        .tgt-ops-shell .logout-button,.tgt-marker-live-back,.tgt-marker-live-refresh{border-color:rgba(255,255,255,.34)!important;color:#fff!important;background:rgba(255,255,255,.12)!important}
        .tgt-marker-live-toggle button.active,.tgt-course-list button.active{border-color:#168454!important;color:#fff!important;background:#168454!important}
        .tgt-marker-live-table th{color:#fff!important;border-bottom-color:rgba(255,255,255,.18)!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1,.tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1 span{color:#fff!important;background:none!important;-webkit-text-fill-color:#fff!important;filter:none!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-kicker{border-color:rgba(255,255,255,.38)!important;color:#fff!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-primary-action{border-color:#fff!important;color:#fff!important;background:#168454!important}
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.20)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(238,250,242,.72)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(255,255,255,.14)!important}.tgt-fixed-play-disc{border-color:#fff!important;color:#fff!important;background:linear-gradient(145deg,#ef5a61,#c9323a)!important}
`}</style><section className="tgt-player-home">
  <header className="tgt-player-appbar">
    <div className="tgt-player-brand"><span className="tgt-player-brandmark">TGT</span><span><strong>MIT TGT</strong><small>THE GOLDEN TEE TOUR</small></span></div>

  </header>
  <section className="tgt-player-head"><div><p className="eyebrow" style={{color:"#dff0e5"}}>MIN PROFIL</p><h1>Hej {profile?.name?.split(" ")[0]??"spiller"}</h1><div className="tgt-player-meta"><span>{dguNumber}</span><span>{clubName}</span></div></div></section>
  <div className="tgt-player-content">{loading&&<div className="status-box">Henter din spillerprofil...</div>}{errorMessage&&<div className="error-box">{errorMessage}</div>}{message&&<div className="status-box">{message}</div>}{!loading&&!profile&&!errorMessage&&<div className="status-box">Spillerprofilen blev ikke fundet i TGT 2027. Kontrollér at spillerens e-mail eller brugernavn matcher login-brugeren.</div>}{!loading&&profile&&<><section className="tgt-player-intro"><div className="tgt-player-avatar">{getInitials(profile.name)}</div><div><h2 style={{margin:"0 0 4px"}}>{profile.name}</h2><span>TGT {profile.tournaments?.season??"–"}</span></div></section><button type="button" className="tgt-player-primary" onClick={()=>onStartScoring(profile.id)}>Start scoreindtastning</button><section className="tgt-player-kpis"><div className="tgt-player-kpi"><span>Sæsonstilling</span><strong>{position?`#${position}`:"–"}</strong></div><div className="tgt-player-kpi"><span>Sæsonscore</span><strong>{seasonScore===null?"–":formatScore(seasonScore)}</strong></div><div className="tgt-player-kpi"><span>Handicap</span><strong>{profile.handicap_index??"–"}</strong>{!editingHcp?<button type="button" className="tgt-hcp-link" onClick={()=>setEditingHcp(true)} aria-label="Redigér handicap" title="Redigér handicap">✎</button>:<div className="tgt-hcp-edit"><input inputMode="decimal" value={hcpDraft} onChange={e=>setHcpDraft(e.target.value)} aria-label="Nyt handicap"/><button className="tgt-hcp-save" onClick={saveHandicap} disabled={savingHcp}>{savingHcp?"Gemmer...":"Gem"}</button><button onClick={()=>{setEditingHcp(false);setHcpDraft(profile.handicap_index??"")}}>Annullér</button></div>}</div><div className="tgt-player-kpi"><span>Resultater</span><strong>{results.length}</strong></div></section><div className="tgt-player-grid"><section className="tgt-player-panel"><p className="eyebrow">Mine resultater</p><h2>Seneste runder</h2>{latest.length===0?<div className="status-box">Resultater registreres automatisk fra kommende runder.</div>:latest.map((r,i)=><div className="tgt-player-result" key={`${r.player_id}-${r.round_number}-${i}`}><span>TGT {r.tournaments?.season??"–"} · Runde {r.round_number}</span><strong>{formatScore(r.score)}</strong></div>)}</section><aside className="tgt-player-panel"><p className="eyebrow">Spillerstatistik</p><h2>Sæson {profile.tournaments?.season??"–"}</h2><div className="tgt-player-stat-grid">{[["Huller",playerStats.holes],["Eagles+",playerStats.eagles],["Birdies",playerStats.birdies],["Pars",playerStats.pars],["Bogeys",playerStats.bogeys],["Double+",playerStats.doublePlus]].map(([label,value])=><div className="tgt-player-stat" key={label}><strong>{value}</strong><small>{label}</small></div>)}</div>{playerStats.holes===0&&<div className="status-box" style={{marginTop:12}}>Statistik vises automatisk, når scorekort er gemt.</div>}</aside></div></>}</div></section><MitTgtBottomNav active="profile" onProfile={()=>onNavigate("profile")} onLeaderboard={()=>onNavigate("leaderboard")} onPlay={()=>profile&&onStartScoring(profile.id)} onLive={()=>onNavigate("live-leaderboard")} onMenu={()=>onNavigate("menu")} playDisabled={!profile} /></main>;
}

function SeasonPlayersAdmin({ season = ACTIVE_SEASON }) {
  const [players, setPlayers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingPlayerId, setSavingPlayerId] = useState(null);
  const [creatingPlayer, setCreatingPlayer] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [newPlayer, setNewPlayer] = useState({
    name: "",
    email: "",
    handicapIndex: "",
    dguNumber: "",
    clubName: "",
    teamCompetition: true,
  });

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const result = await getSeasonPlayers(season);
      setPlayers(result.players);

      const nextDrafts = {};
      result.players.forEach((player) => {
        nextDrafts[player.id] = {
          name: player.name ?? "",
          email: player.email ?? "",
          handicapIndex: player.handicap_index ?? "",
          dguNumber: player.dgu_number ?? "",
          clubName: player.club_name ?? "",
          genderCode: player.gender_code ?? "",
          active: player.active,
          teamCompetition: player.team_competition,
        };
      });
      setDrafts(nextDrafts);
    } catch (error) {
      console.error("Fejl ved hentning af sæsonspillere:", error);
      setErrorMessage(
        error.message ?? "Spillerne kunne ikke hentes."
      );
    } finally {
      setLoading(false);
    }
  }, [season]);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  const summary = summarizeSeasonPlayers(players);

  function updateDraft(playerId, field, value) {
    setDrafts((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        [field]: value,
      },
    }));
    setMessage("");
    setErrorMessage("");
  }

  async function handleSavePlayer(playerId) {
    const draft = drafts[playerId];
    if (!draft) return;

    setSavingPlayerId(playerId);
    setMessage("");
    setErrorMessage("");

    try {
      const savedPlayer = await updateSeasonPlayer({
        playerId,
        name: draft.name,
        email: draft.email,
        handicapIndex: draft.handicapIndex,
        active: draft.active,
        teamCompetition: draft.teamCompetition,
        genderCode: draft.genderCode,
      });
      const { error: profileFieldError } = await supabase
        .from("players")
        .update({
          dgu_number: draft.dguNumber.trim() || null,
          club_name: draft.clubName.trim() || null,
        })
        .eq("id", playerId);
      if (profileFieldError) throw profileFieldError;
      setMessage(`${savedPlayer.name} er gemt.`);
      await loadPlayers();
    } catch (error) {
      console.error("Fejl ved gemning af spiller:", error);
      setErrorMessage(
        error.message ?? "Spilleren kunne ikke gemmes."
      );
    } finally {
      setSavingPlayerId(null);
    }
  }

  async function handleCreatePlayer(event) {
    event.preventDefault();
    setCreatingPlayer(true);
    setMessage("");
    setErrorMessage("");

    try {
      const createdPlayer = await createSeasonPlayer({
        season,
        name: newPlayer.name,
        email: newPlayer.email,
        handicapIndex: newPlayer.handicapIndex,
        teamCompetition: newPlayer.teamCompetition,
      });
      const { error: profileFieldError } = await supabase
        .from("players")
        .update({
          dgu_number: newPlayer.dguNumber.trim() || null,
          club_name: newPlayer.clubName.trim() || null,
        })
        .eq("id", createdPlayer.id);
      if (profileFieldError) throw profileFieldError;
      setNewPlayer({
        name: "",
        email: "",
        handicapIndex: "",
        dguNumber: "",
        clubName: "",
        teamCompetition: true,
      });
      setMessage(`${createdPlayer.name} er oprettet i TGT ${season}.`);
      await loadPlayers();
    } catch (error) {
      console.error("Fejl ved oprettelse af spiller:", error);
      setErrorMessage(
        error.message ?? "Spilleren kunne ikke oprettes."
      );
    } finally {
      setCreatingPlayer(false);
    }
  }

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Spilleradministration</h2>

      {loading && (
        <div className="status-box">Henter spillere...</div>
      )}

      {!loading && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Alle</span><strong>{summary.totalPlayers}</strong></div>
            <div><span>Aktive</span><strong>{summary.activePlayers}</strong></div>
            <div><span>Holdspillere</span><strong>{summary.teamPlayers}</strong></div>
            <div><span>Kun individuel</span><strong>{summary.individualOnlyPlayers}</strong></div>
            <div><span>Inaktive</span><strong>{summary.inactivePlayers}</strong></div>
            <div><span>Mangler handicap</span><strong>{summary.missingHandicap}</strong></div>
          </div>

          {errorMessage && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              {errorMessage}
            </div>
          )}

          {message && (
            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 10,
                background: "#e7f6eb",
                color: "#176334",
                fontWeight: 700,
              }}
            >
              {message}
            </div>
          )}

          <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
            {players.map((player) => {
              const draft = drafts[player.id];
              if (!draft) return null;

              return (
                <article
                  key={player.id}
                  style={{
                    padding: 16,
                    border: "1px solid #e1e8e3",
                    borderRadius: 14,
                    background: draft.active ? "#fafbf9" : "#f4f4f4",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(160px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        updateDraft(player.id, "name", event.target.value)
                      }
                      className="form-input"
                      placeholder="Navn"
                    />
                    <input
                      type="email"
                      value={draft.email}
                      onChange={(event) =>
                        updateDraft(player.id, "email", event.target.value)
                      }
                      className="form-input"
                      placeholder="E-mail"
                    />
                    <input
                      value={draft.dguNumber}
                      onChange={(event) => updateDraft(player.id, "dguNumber", event.target.value)}
                      className="form-input"
                      placeholder="DGU-nummer"
                    />
                    <input
                      value={draft.clubName}
                      onChange={(event) => updateDraft(player.id, "clubName", event.target.value)}
                      className="form-input"
                      placeholder="Klub"
                    />
                    <input
                      type="number"
                      step="0.1"
                      min="-10"
                      max="54"
                      value={draft.handicapIndex}
                      onChange={(event) =>
                        updateDraft(
                          player.id,
                          "handicapIndex",
                          event.target.value
                        )
                      }
                      className="form-input"
                      placeholder="HCP"
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 18,
                      marginTop: 12,
                    }}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.active}
                        onChange={(event) =>
                          updateDraft(player.id, "active", event.target.checked)
                        }
                      />{" "}
                      Aktiv
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.teamCompetition}
                        onChange={(event) =>
                          updateDraft(
                            player.id,
                            "teamCompetition",
                            event.target.checked
                          )
                        }
                      />{" "}
                      Holdturnering
                    </label>
                    <button
                      type="button"
                      onClick={() => handleSavePlayer(player.id)}
                      disabled={savingPlayerId === player.id}
                      className="login-submit-button"
                      style={{ width: "auto", margin: "0 0 0 auto" }}
                    >
                      {savingPlayerId === player.id ? "Gemmer..." : "Gem spiller"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <form
            onSubmit={handleCreatePlayer}
            style={{
              marginTop: 26,
              paddingTop: 22,
              borderTop: "1px solid #e1e8e3",
            }}
          >
            <p className="eyebrow">Ny deltager</p>
            <h3 style={{ margin: "5px 0 14px" }}>Tilføj spiller</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 10,
              }}
            >
              <input
                value={newPlayer.name}
                onChange={(event) =>
                  setNewPlayer((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Fulde navn"
                required
              />
              <input
                type="email"
                value={newPlayer.email}
                onChange={(event) =>
                  setNewPlayer((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="E-mail, valgfri"
              />
              <input
                value={newPlayer.dguNumber}
                onChange={(event) => setNewPlayer((current) => ({ ...current, dguNumber: event.target.value }))}
                className="form-input"
                placeholder="DGU-nummer"
              />
              <input
                value={newPlayer.clubName}
                onChange={(event) => setNewPlayer((current) => ({ ...current, clubName: event.target.value }))}
                className="form-input"
                placeholder="Klub"
              />
              <input
                type="number"
                step="0.1"
                min="-10"
                max="54"
                value={newPlayer.handicapIndex}
                onChange={(event) =>
                  setNewPlayer((current) => ({
                    ...current,
                    handicapIndex: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="HCP"
              />
            </div>
            <label style={{ display: "block", marginTop: 12 }}>
              <input
                type="checkbox"
                checked={newPlayer.teamCompetition}
                onChange={(event) =>
                  setNewPlayer((current) => ({
                    ...current,
                    teamCompetition: event.target.checked,
                  }))
                }
              />{" "}
              Deltager i holdturneringen
            </label>
            <button
              type="submit"
              disabled={creatingPlayer}
              className="login-submit-button"
              style={{ maxWidth: 300 }}
            >
              {creatingPlayer ? "Opretter..." : "Opret spiller"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function SeasonTeamsAdmin({ season = ACTIVE_SEASON }) {
  const [teams, setTeams] = useState([]);
  const [eligiblePlayers, setEligiblePlayers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [newTeam, setNewTeam] = useState({
    name: "",
    playerOneId: "",
    playerTwoId: "",
  });
  const [loading, setLoading] = useState(true);
  const [savingTeamId, setSavingTeamId] = useState(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const result = await getSeasonTeams(season);
      setTeams(result.teams);
      setEligiblePlayers(result.eligiblePlayers);

      const nextDrafts = {};
      result.teams.forEach((team) => {
        nextDrafts[team.id] = {
          name: team.name,
          playerOneId: team.members[0]?.playerId ?? "",
          playerTwoId: team.members[1]?.playerId ?? "",
        };
      });
      setDrafts(nextDrafts);
    } catch (error) {
      console.error("Fejl ved hentning af hold:", error);
      setErrorMessage(error.message ?? "Holdene kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, [season]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const summary = summarizeSeasonTeams({ teams, eligiblePlayers });

  function updateDraft(teamId, field, value) {
    setDrafts((current) => ({
      ...current,
      [teamId]: {
        ...current[teamId],
        [field]: value,
      },
    }));
    setMessage("");
    setErrorMessage("");
  }

  function playerOptionsForTeam(teamId) {
    const currentMemberIds = new Set(
      teams
        .find((team) => team.id === teamId)
        ?.members.map((member) => member.playerId) ?? []
    );

    const assignedElsewhere = new Set(
      teams
        .filter((team) => team.active && team.id !== teamId)
        .flatMap((team) => team.members.map((member) => member.playerId))
    );

    return eligiblePlayers.filter(
      (player) =>
        currentMemberIds.has(player.id) || !assignedElsewhere.has(player.id)
    );
  }

  const assignedActivePlayerIds = new Set(
    teams
      .filter((team) => team.active)
      .flatMap((team) => team.members.map((member) => member.playerId))
  );

  const availableForNewTeam = eligiblePlayers.filter(
    (player) => !assignedActivePlayerIds.has(player.id)
  );

  async function handleSaveTeam(teamId) {
    const draft = drafts[teamId];
    if (!draft) return;

    setSavingTeamId(teamId);
    setMessage("");
    setErrorMessage("");

    try {
      const saved = await updateSeasonTeam({
        teamId,
        name: draft.name,
        playerIds: [draft.playerOneId, draft.playerTwoId],
      });
      setMessage(`${saved.name} er gemt.`);
      await loadTeams();
    } catch (error) {
      console.error("Fejl ved gemning af hold:", error);
      setErrorMessage(error.message ?? "Holdet kunne ikke gemmes.");
    } finally {
      setSavingTeamId(null);
    }
  }

  async function handleDeactivateTeam(team) {
    const confirmed = window.confirm(
      `Vil du deaktivere ${team.name} og frigive spillerne?`
    );
    if (!confirmed) return;

    setSavingTeamId(team.id);
    setMessage("");
    setErrorMessage("");

    try {
      await deactivateAndReleaseTeam(team.id);
      setMessage(`${team.name} er deaktiveret, og spillerne er frigivet.`);
      await loadTeams();
    } catch (error) {
      console.error("Fejl ved deaktivering af hold:", error);
      setErrorMessage(error.message ?? "Holdet kunne ikke deaktiveres.");
    } finally {
      setSavingTeamId(null);
    }
  }

  async function handleCreateTeam(event) {
    event.preventDefault();
    setCreatingTeam(true);
    setMessage("");
    setErrorMessage("");

    try {
      const created = await createSeasonTeam({
        season,
        name: newTeam.name,
        playerIds: [newTeam.playerOneId, newTeam.playerTwoId],
      });
      setNewTeam({ name: "", playerOneId: "", playerTwoId: "" });
      setMessage(`${created.name} er oprettet.`);
      await loadTeams();
    } catch (error) {
      console.error("Fejl ved oprettelse af hold:", error);
      setErrorMessage(error.message ?? "Holdet kunne ikke oprettes.");
    } finally {
      setCreatingTeam(false);
    }
  }

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Holdadministration</h2>

      {loading && <div className="status-box">Henter hold...</div>}

      {!loading && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Alle hold</span><strong>{summary.totalTeams}</strong></div>
            <div><span>Aktive hold</span><strong>{summary.activeTeams}</strong></div>
            <div><span>Fordelte spillere</span><strong>{summary.assignedPlayers}</strong></div>
            <div><span>Ledige holdspillere</span><strong>{summary.availablePlayers}</strong></div>
            <div><span>Inaktive hold</span><strong>{summary.inactiveTeams}</strong></div>
            <div><span>Ugyldige hold</span><strong>{summary.invalidActiveTeams}</strong></div>
          </div>

          {errorMessage && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              {errorMessage}
            </div>
          )}

          {message && (
            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 10,
                background: "#e7f6eb",
                color: "#176334",
                fontWeight: 700,
              }}
            >
              {message}
            </div>
          )}

          <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
            {teams.map((team) => {
              const draft = drafts[team.id];
              if (!draft) return null;
              const options = playerOptionsForTeam(team.id);

              return (
                <article
                  key={team.id}
                  style={{
                    padding: 16,
                    border: "1px solid #e1e8e3",
                    borderRadius: 14,
                    background: team.active ? "#fafbf9" : "#f4f4f4",
                  }}
                >
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft(team.id, "name", event.target.value)
                    }
                    className="form-input"
                    placeholder="Holdnavn"
                    disabled={!team.active}
                  />

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    {[
                      ["playerOneId", "Spiller 1"],
                      ["playerTwoId", "Spiller 2"],
                    ].map(([field, label]) => (
                      <select
                        key={field}
                        value={draft[field]}
                        onChange={(event) =>
                          updateDraft(team.id, field, event.target.value)
                        }
                        className="form-input"
                        disabled={!team.active}
                      >
                        <option value="">{label}</option>
                        {options.map((player) => (
                          <option
                            key={player.id}
                            value={player.id}
                            disabled={
                              field === "playerOneId"
                                ? player.id === draft.playerTwoId
                                : player.id === draft.playerOneId
                            }
                          >
                            {player.name}
                          </option>
                        ))}
                      </select>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      flexWrap: "wrap",
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
                    {team.active ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDeactivateTeam(team)}
                          disabled={savingTeamId === team.id}
                          className="login-cancel-button"
                          style={{ width: "auto", marginTop: 0 }}
                        >
                          Deaktivér og frigiv
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveTeam(team.id)}
                          disabled={savingTeamId === team.id}
                          className="login-submit-button"
                          style={{ width: "auto", marginTop: 0 }}
                        >
                          {savingTeamId === team.id ? "Gemmer..." : "Gem hold"}
                        </button>
                      </>
                    ) : (
                      <strong style={{ color: "#78827d" }}>Inaktivt hold</strong>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <form
            onSubmit={handleCreateTeam}
            style={{
              marginTop: 26,
              paddingTop: 22,
              borderTop: "1px solid #e1e8e3",
            }}
          >
            <p className="eyebrow">Nyt makkerpar</p>
            <h3 style={{ margin: "5px 0 14px" }}>Opret hold</h3>

            <input
              value={newTeam.name}
              onChange={(event) =>
                setNewTeam((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              className="form-input"
              placeholder="Holdnavn"
              required
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginTop: 10,
              }}
            >
              <select
                value={newTeam.playerOneId}
                onChange={(event) =>
                  setNewTeam((current) => ({
                    ...current,
                    playerOneId: event.target.value,
                  }))
                }
                className="form-input"
                required
              >
                <option value="">Vælg spiller 1</option>
                {availableForNewTeam.map((player) => (
                  <option
                    key={player.id}
                    value={player.id}
                    disabled={player.id === newTeam.playerTwoId}
                  >
                    {player.name}
                  </option>
                ))}
              </select>

              <select
                value={newTeam.playerTwoId}
                onChange={(event) =>
                  setNewTeam((current) => ({
                    ...current,
                    playerTwoId: event.target.value,
                  }))
                }
                className="form-input"
                required
              >
                <option value="">Vælg spiller 2</option>
                {availableForNewTeam.map((player) => (
                  <option
                    key={player.id}
                    value={player.id}
                    disabled={player.id === newTeam.playerOneId}
                  >
                    {player.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={
                creatingTeam ||
                !newTeam.name.trim() ||
                !newTeam.playerOneId ||
                !newTeam.playerTwoId
              }
              className="login-submit-button"
              style={{ maxWidth: 300 }}
            >
              {creatingTeam ? "Opretter..." : "Opret hold"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function SeasonRoundsAdmin({ season = ACTIVE_SEASON }) {
  const emptyRound = {
    roundNumber: "",
    name: "",
    playedAt: "",
    courseId: "",
    teeId: "",
    roundType: "regular",
    individualEnabled: true,
    teamEnabled: true,
    closestToPinEnabled: true,
    liveLeaderboardMode: "none",
  };

  const [rounds, setRounds] = useState([]);
  const [courses, setCourses] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [teesByCourse, setTeesByCourse] = useState({});
  const [newRound, setNewRound] = useState(emptyRound);
  const [newRoundTees, setNewRoundTees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingRoundId, setSavingRoundId] = useState(null);
  const [creatingRound, setCreatingRound] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadRounds = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const result = await getSeasonRounds(season);
      const roundIds = result.rounds.map((round) => round.id);
      let liveFlags = [];
      if (roundIds.length > 0) {
        const { data: flagRows, error: flagError } = await supabase
          .from("rounds")
          .select("id, live_leaderboard_mode")
          .in("id", roundIds);
        if (flagError) throw flagError;
        liveFlags = flagRows ?? [];
      }
      const liveModeByRoundId = new Map(
        liveFlags.map((round) => [round.id, round.live_leaderboard_mode ?? "none"])
      );
      const roundsWithLiveFlag = result.rounds.map((round) => ({
        ...round,
        live_leaderboard_mode: liveModeByRoundId.get(round.id) ?? "none",
      }));
      setRounds(roundsWithLiveFlag);
      setCourses(result.courses);

      const nextDrafts = {};
      const courseIds = [
        ...new Set(roundsWithLiveFlag.map((round) => round.course_id).filter(Boolean)),
      ];
      const teeEntries = await Promise.all(
        courseIds.map(async (courseId) => [
          courseId,
          await getCourseTees(courseId),
        ])
      );
      const nextTeesByCourse = Object.fromEntries(teeEntries);
      setTeesByCourse(nextTeesByCourse);

      roundsWithLiveFlag.forEach((round) => {
        nextDrafts[round.id] = {
          roundNumber: round.round_number,
          name: round.name,
          playedAt: round.played_at ?? "",
          courseId: round.course_id ?? "",
          teeId: round.tee_id ?? "",
          roundType: round.round_type ?? "regular",
          individualEnabled: round.individual_enabled,
          teamEnabled: round.team_enabled,
          closestToPinEnabled: round.closest_to_pin_enabled,
          liveLeaderboardMode: round.live_leaderboard_mode ?? "none",
        };
      });
      setDrafts(nextDrafts);
    } catch (error) {
      console.error("Fejl ved hentning af 2027-runder:", error);
      setErrorMessage(error.message ?? "Runderne kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, [season]);

  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  const summary = summarizeSeasonRounds(rounds);

  async function ensureTees(courseId) {
    if (!courseId || teesByCourse[courseId]) return;
    const tees = await getCourseTees(courseId);
    setTeesByCourse((current) => ({ ...current, [courseId]: tees }));
  }

  function updateDraft(roundId, field, value) {
    setDrafts((current) => ({
      ...current,
      [roundId]: { ...current[roundId], [field]: value },
    }));
    setMessage("");
    setErrorMessage("");
  }

  async function handleDraftCourseChange(roundId, courseId) {
    updateDraft(roundId, "courseId", courseId);
    updateDraft(roundId, "teeId", "");
    try {
      await ensureTees(courseId);
    } catch (error) {
      setErrorMessage(error.message ?? "Teestederne kunne ikke hentes.");
    }
  }

  async function handleNewCourseChange(courseId) {
    setNewRound((current) => ({ ...current, courseId, teeId: "" }));
    setNewRoundTees([]);
    if (!courseId) return;
    try {
      setNewRoundTees(await getCourseTees(courseId));
    } catch (error) {
      setErrorMessage(error.message ?? "Teestederne kunne ikke hentes.");
    }
  }

  async function handleSaveRound(roundId) {
    const draft = drafts[roundId];
    if (!draft) return;

    setSavingRoundId(roundId);
    setMessage("");
    setErrorMessage("");

    try {
      const saved = await updateSeasonRound({
        roundId,
        roundNumber: draft.roundNumber,
        name: draft.name,
        playedAt: draft.playedAt,
        courseId: draft.courseId,
        teeId: draft.teeId,
        roundType: draft.roundType,
        individualEnabled: draft.individualEnabled,
        teamEnabled: draft.teamEnabled,
        closestToPinEnabled: draft.closestToPinEnabled,
      });
      const { error: liveFlagError } = await supabase
        .from("rounds")
        .update({ live_leaderboard_mode: draft.liveLeaderboardMode ?? "none" })
        .eq("id", roundId);
      if (liveFlagError) throw liveFlagError;
      setMessage(`Runde ${saved.round_number} er gemt.`);
      await loadRounds();
    } catch (error) {
      console.error("Fejl ved gemning af runde:", error);
      setErrorMessage(error.message ?? "Runden kunne ikke gemmes.");
    } finally {
      setSavingRoundId(null);
    }
  }

  async function handleDeleteRound(round) {
    if (!round?.id) return;
    if (round.locked_at) {
      setErrorMessage("Runden er låst og skal genåbnes, før den kan slettes.");
      return;
    }

    const confirmed = window.confirm(
      `Vil du slette Runde ${round.round_number} · ${round.name}? Deltagere, bolde, markørtilknytninger og øvrige data på runden kan også blive slettet. Handlingen kan ikke fortrydes.`
    );
    if (!confirmed) return;

    setSavingRoundId(round.id);
    setMessage("");
    setErrorMessage("");
    try {
      const { data: deletedRows, error } = await supabase
        .from("rounds")
        .delete()
        .eq("id", round.id)
        .select("id");
      if (error) throw error;
      if (!deletedRows?.some((deletedRound) => deletedRound.id === round.id)) {
        throw new Error("Runden blev ikke slettet. Kontrollér administratorrettighederne.");
      }

      setRounds((current) =>
        current.filter((currentRound) => currentRound.id !== round.id)
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[round.id];
        return next;
      });
      setMessage(`Runde ${round.round_number} · ${round.name} er slettet.`);
      await loadRounds();
    } catch (error) {
      console.error("Fejl ved sletning af runde:", error);
      setErrorMessage(
        error.message ??
          "Runden kunne ikke slettes. Kontrollér sletterettigheder og relationer i databasen."
      );
    } finally {
      setSavingRoundId(null);
    }
  }

  async function handleCreateRound(event) {
    event.preventDefault();
    setCreatingRound(true);
    setMessage("");
    setErrorMessage("");

    try {
      const created = await createSeasonRound({
        season,
        roundNumber: newRound.roundNumber,
        name: newRound.name,
        playedAt: newRound.playedAt,
        courseId: newRound.courseId,
        teeId: newRound.teeId,
        roundType: newRound.roundType,
        individualEnabled: newRound.individualEnabled,
        teamEnabled: newRound.teamEnabled,
        closestToPinEnabled: newRound.closestToPinEnabled,
      });

      const { error: liveFlagError } = await supabase
        .from("rounds")
        .update({ live_leaderboard_mode: newRound.liveLeaderboardMode ?? "none" })
        .eq("id", created.id);
      if (liveFlagError) throw liveFlagError;
      if (newRound.closestToPinEnabled && newRound.courseId) {
        const { data: parThreeRows, error: parThreeError } = await supabase
          .from("course_holes")
          .select("hole_number")
          .eq("course_id", newRound.courseId)
          .eq("par", 3)
          .order("hole_number", { ascending: true });
        if (parThreeError) throw parThreeError;

        const { error: closestHoleError } = await supabase.rpc(
          "set_round_closest_to_pin_holes",
          {
            requested_round_id: created.id,
            requested_hole_numbers: (parThreeRows ?? []).map((hole) =>
              Number(hole.hole_number)
            ),
          }
        );
        if (closestHoleError) throw closestHoleError;
      }

      setNewRound(emptyRound);
      setNewRoundTees([]);
      setMessage(
        `Runde ${created.round_number} er oprettet${
          newRound.closestToPinEnabled
            ? " med alle banens par 3-huller til Tættest på pinden"
            : ""
        }.`
      );
      await loadRounds();
    } catch (error) {
      console.error("Fejl ved oprettelse af runde:", error);
      setErrorMessage(error.message ?? "Runden kunne ikke oprettes.");
    } finally {
      setCreatingRound(false);
    }
  }

  function RoundSwitches({ value, onChange, disabled = false }) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        {[
          ["individualEnabled", "Individuel"],
          ["teamEnabled", "Holdturnering"],
          ["closestToPinEnabled", "Tættest på pinden"],
        ].map(([field, label]) => (
          <label key={field}>
            <input
              type="checkbox"
              checked={Boolean(value[field])}
              onChange={(event) => onChange(field, event.target.checked)}
              disabled={disabled}
            />{" "}
            {label}
          </label>
        ))}
      </div>
    );
  }

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Rundeadministration</h2>

      {loading && <div className="status-box">Henter runder og baner...</div>}

      {!loading && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Runder</span><strong>{summary.totalRounds}</strong></div>
            <div><span>Kladder</span><strong>{summary.draftRounds}</strong></div>
            <div><span>Individuelle</span><strong>{summary.individualRounds}</strong></div>
            <div><span>Holdrunder</span><strong>{summary.teamRounds}</strong></div>
            <div><span>Tættest på pinden</span><strong>{summary.closestToPinRounds}</strong></div>
            <div><span>Mangler opsætning</span><strong>{summary.roundsWithoutCourse + summary.roundsWithoutTee}</strong></div>
          </div>

          {errorMessage && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              {errorMessage}
            </div>
          )}

          {message && (
            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 10,
                background: "#e7f6eb",
                color: "#176334",
                fontWeight: 700,
              }}
            >
              {message}
            </div>
          )}

          <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
            {rounds.map((round) => {
              const draft = drafts[round.id];
              if (!draft) return null;
              const isLocked = Boolean(round.locked_at);
              const tees = teesByCourse[draft.courseId] ?? [];

              return (
                <article
                  key={round.id}
                  className="tgt-admin-round-card"
                  style={{
                    padding: 16,
                    border: "1px solid #e1e8e3",
                    borderRadius: 14,
                    background: isLocked ? "#eef7f0" : "#fafbf9",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px minmax(220px, 1.5fr) 170px",
                      gap: 10,
                    }}
                  >
                    <input
                      type="number"
                      min="1"
                      value={draft.roundNumber}
                      onChange={(event) =>
                        updateDraft(round.id, "roundNumber", event.target.value)
                      }
                      className="form-input"
                      placeholder="Nr."
                      disabled={isLocked}
                    />
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        updateDraft(round.id, "name", event.target.value)
                      }
                      className="form-input"
                      placeholder="Rundenavn"
                      disabled={isLocked}
                    />
                    <input
                      type="date"
                      value={draft.playedAt}
                      onChange={(event) =>
                        updateDraft(round.id, "playedAt", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    />
                  </div>

                  <div className="tgt-admin-round-fields">
                    <label className="tgt-admin-field">
                      <span className="tgt-admin-field-label">Bane</span>
                    <select
                      value={draft.courseId}
                      onChange={(event) =>
                        handleDraftCourseChange(round.id, event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    >
                      <option value="">Vælg bane</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.club_name} · {course.course_name}
                        </option>
                      ))}
                    </select>
                    </label>
                    <label className="tgt-admin-field">
                      <span className="tgt-admin-field-label">Tee</span>
                    <select
                      value={draft.teeId}
                      onChange={(event) =>
                        updateDraft(round.id, "teeId", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked || !draft.courseId}
                    >
                      <option value="">Vælg tee</option>
                      {tees.map((tee) => (
                        <option key={tee.id} value={tee.id}>
                          {tee.tee_name}
                        </option>
                      ))}
                    </select>
                    </label>
                    <label className="tgt-admin-field">
                      <span className="tgt-admin-field-label">Rundetype</span>
                    <select
                      value={draft.roundType}
                      onChange={(event) =>
                        updateDraft(round.id, "roundType", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    >
                      <option value="regular">Grundspil</option>
                      <option value="team_final">Holdfinale</option>
                      <option value="individual_final">Individuel finale</option>
                    </select>
                    </label>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 14,
                      marginTop: 14,
                    }}
                  >
                    <RoundSwitches
                      value={draft}
                      disabled={isLocked}
                      onChange={(field, value) =>
                        updateDraft(round.id, field, value)
                      }
                    />
                    <label style={{ minWidth: 260 }}>
                      <span className="tgt-admin-field-label">Samlet leaderboard live</span>
                      <select
                        value={draft.liveLeaderboardMode ?? "none"}
                        onChange={(event) =>
                          updateDraft(round.id, "liveLeaderboardMode", event.target.value)
                        }
                        className="form-input"
                        disabled={isLocked}
                      >
                        <option value="none">Ingen</option>
                        <option value="individual">Individuel</option>
                        <option value="team">Hold</option>
                        <option value="both">Begge</option>
                      </select>
                    </label>
                    <ClosestToPinHoleSelector roundId={round.id} courseId={draft.courseId} disabled={isLocked} />
                    <div className="tgt-round-admin-actions">
                      <button
                        type="button"
                        onClick={() => handleDeleteRound(round)}
                        disabled={isLocked || savingRoundId === round.id}
                        className="login-cancel-button tgt-delete-round-button"
                        style={{ width: "auto", marginTop: 0 }}
                      >
                        {isLocked
                          ? "Genåbn før sletning"
                          : savingRoundId === round.id
                            ? "Arbejder..."
                            : "Slet runde"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveRound(round.id)}
                        disabled={isLocked || savingRoundId === round.id}
                        className="login-submit-button"
                        style={{ width: "auto", marginTop: 0 }}
                      >
                        {isLocked
                          ? "Runden er låst"
                          : savingRoundId === round.id
                            ? "Gemmer..."
                            : "Gem runde"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <form
            onSubmit={handleCreateRound}
            style={{
              marginTop: 26,
              paddingTop: 22,
              borderTop: "1px solid #e1e8e3",
            }}
          >
            <p className="eyebrow">Ny spilledag</p>
            <h3 style={{ margin: "5px 0 14px" }}>Opret runde</h3>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "110px minmax(220px, 1.5fr) 170px",
                gap: 10,
              }}
            >
              <input
                type="number"
                min="1"
                value={newRound.roundNumber}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    roundNumber: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Nr."
                required
              />
              <input
                value={newRound.name}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Rundenavn"
                required
              />
              <input
                type="date"
                value={newRound.playedAt}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    playedAt: event.target.value,
                  }))
                }
                className="form-input"
                required
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr",
                gap: 10,
                marginTop: 10,
              }}
            >
              <select
                value={newRound.courseId}
                onChange={(event) => handleNewCourseChange(event.target.value)}
                className="form-input"
                required
              >
                <option value="">Vælg bane</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.club_name} · {course.course_name}
                  </option>
                ))}
              </select>
              <select
                value={newRound.teeId}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    teeId: event.target.value,
                  }))
                }
                className="form-input"
                disabled={!newRound.courseId}
                required
              >
                <option value="">Vælg tee</option>
                {newRoundTees.map((tee) => (
                  <option key={tee.id} value={tee.id}>
                    {tee.tee_name}
                  </option>
                ))}
              </select>
              <select
                value={newRound.roundType}
                onChange={(event) =>
                  setNewRound((current) => ({
                    ...current,
                    roundType: event.target.value,
                  }))
                }
                className="form-input"
              >
                <option value="regular">Grundspil</option>
                <option value="team_final">Holdfinale</option>
                <option value="individual_final">Individuel finale</option>
              </select>
            </div>

            <div style={{ marginTop: 14 }}>
              <RoundSwitches
                value={newRound}
                onChange={(field, value) =>
                  setNewRound((current) => ({
                    ...current,
                    [field]: value,
                  }))
                }
              />
              <label style={{ display: "block", maxWidth: 420, marginTop: 14 }}>
                <span className="tgt-admin-field-label">Samlet leaderboard live</span>
                <select
                  value={newRound.liveLeaderboardMode ?? "none"}
                  onChange={(event) =>
                    setNewRound((current) => ({
                      ...current,
                      liveLeaderboardMode: event.target.value,
                    }))
                  }
                  className="form-input"
                >
                  <option value="none">Ingen</option>
                  <option value="individual">Individuel</option>
                  <option value="team">Hold</option>
                  <option value="both">Begge</option>
                </select>
              </label>
            </div>

            <button
              type="submit"
              disabled={creatingRound}
              className="login-submit-button"
              style={{ maxWidth: 300 }}
            >
              {creatingRound ? "Opretter..." : "Opret runde"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function RoundParticipantsAdmin({ season = ACTIVE_SEASON }) {
  const [rounds, setRounds] = useState([]);
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [selectedRound, setSelectedRound] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loadingRounds, setLoadingRounds] = useState(true);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadRounds = useCallback(async () => {
    setLoadingRounds(true);
    setErrorMessage("");

    try {
      const result = await getSeasonRounds(season);
      setRounds(result.rounds);

      if (
        selectedRoundId &&
        !result.rounds.some((round) => round.id === selectedRoundId)
      ) {
        setSelectedRoundId("");
        setSelectedRound(null);
        setParticipants([]);
      }
    } catch (error) {
      console.error("Fejl ved hentning af runder til deltagere:", error);
      setErrorMessage(error.message ?? "Runderne kunne ikke hentes.");
    } finally {
      setLoadingRounds(false);
    }
  }, [season, selectedRoundId]);

  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  async function handleSelectRound(roundId) {
    setSelectedRoundId(roundId);
    setSelectedRound(null);
    setParticipants([]);
    setMessage("");
    setErrorMessage("");

    if (!roundId) return;

    setLoadingParticipants(true);

    try {
      const result = await getRoundParticipants({
        season,
        roundId,
      });

      setSelectedRound(result.round);
      setParticipants(result.participants);
    } catch (error) {
      console.error("Fejl ved hentning af rundedeltagere:", error);
      setErrorMessage(error.message ?? "Deltagerne kunne ikke hentes.");
    } finally {
      setLoadingParticipants(false);
    }
  }

  function setParticipantRegistered(playerId, registered) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.playerId === playerId
          ? {
              ...participant,
              isRegistered: registered,
              status: registered ? "registered" : "withdrawn",
            }
          : participant
      )
    );
    setMessage("");
    setErrorMessage("");
  }

  function setAllParticipants(registered) {
    setParticipants((current) =>
      current.map((participant) => ({
        ...participant,
        isRegistered: registered,
        status: registered ? "registered" : "withdrawn",
      }))
    );
    setMessage("");
    setErrorMessage("");
  }

  async function handleSaveParticipants() {
    if (!selectedRoundId) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      await saveRoundParticipants({
        roundId: selectedRoundId,
        participants: participants.map((participant) => ({
          playerId: participant.playerId,
          registered: participant.isRegistered,
        })),
      });

      setMessage(
        `Deltagerlisten for Runde ${selectedRound.round_number} er gemt.`
      );
      await handleSelectRound(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved gemning af rundedeltagere:", error);
      setErrorMessage(error.message ?? "Deltagerlisten kunne ikke gemmes.");
    } finally {
      setSaving(false);
    }
  }

  const summary = summarizeRoundParticipants(participants);
  const isLocked = Boolean(selectedRound?.locked_at);

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Deltagere pr. runde</h2>
      <p className="description">
        Vælg en runde og markér, hvem der deltager. Frameldte spillere
        forbliver aktive i sæsonen, men kan ikke placeres i en bold på runden.
      </p>

      {loadingRounds ? (
        <div className="status-box">Henter runder...</div>
      ) : rounds.length === 0 ? (
        <div className="status-box">
          Opret mindst én 2027-runde, før deltagerlisten kan administreres.
        </div>
      ) : (
        <select
          value={selectedRoundId}
          onChange={(event) => handleSelectRound(event.target.value)}
          className="form-input"
          style={{ maxWidth: 520 }}
        >
          <option value="">Vælg runde</option>
          {rounds.map((round) => (
            <option key={round.id} value={round.id}>
              Runde {round.round_number} · {round.name} · {round.played_at ?? "Dato mangler"}
            </option>
          ))}
        </select>
      )}

      {loadingParticipants && (
        <div className="status-box">Henter deltagere...</div>
      )}

      {errorMessage && (
        <div className="error-box" style={{ margin: "18px 0 0" }}>
          {errorMessage}
        </div>
      )}

      {message && (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 10,
            background: "#e7f6eb",
            color: "#176334",
            fontWeight: 700,
          }}
        >
          {message}
        </div>
      )}

      {!loadingParticipants && selectedRound && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Aktive spillere</span><strong>{summary.totalPlayers}</strong></div>
            <div><span>Tilmeldt</span><strong>{summary.registeredPlayers}</strong></div>
            <div><span>Frameldt</span><strong>{summary.withdrawnPlayers}</strong></div>
            <div><span>Mangler handicap</span><strong>{summary.missingHandicap}</strong></div>
          </div>

          {isLocked && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              <strong>Runden er låst</strong>
              <span>Deltagerlisten kan ikke ændres, før runden genåbnes.</span>
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 18,
            }}
          >
            <button
              type="button"
              onClick={() => setAllParticipants(true)}
              disabled={isLocked}
              className="login-cancel-button"
              style={{ width: "auto", marginTop: 0 }}
            >
              Tilmeld alle
            </button>
            <button
              type="button"
              onClick={() => setAllParticipants(false)}
              disabled={isLocked}
              className="login-cancel-button"
              style={{ width: "auto", marginTop: 0 }}
            >
              Frameld alle
            </button>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
            {participants.map((participant) => (
              <label
                key={participant.playerId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  padding: 14,
                  border: "1px solid #e1e8e3",
                  borderRadius: 12,
                  background: participant.isRegistered ? "#f3f9f4" : "#f4f4f4",
                }}
              >
                <span>
                  <strong>{participant.playerName}</strong>
                  <small
                    style={{
                      display: "block",
                      marginTop: 4,
                      color: "#78827d",
                    }}
                  >
                    Handicap {participant.currentHandicapIndex ?? "mangler"}
                  </small>
                </span>

                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 700,
                  }}
                >
                  {participant.isRegistered ? "Deltager" : "Meldt fra"}
                  <input
                    type="checkbox"
                    checked={participant.isRegistered}
                    onChange={(event) =>
                      setParticipantRegistered(
                        participant.playerId,
                        event.target.checked
                      )
                    }
                    disabled={isLocked}
                  />
                </span>
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSaveParticipants}
            disabled={saving || isLocked || participants.length === 0}
            className="login-submit-button"
            style={{ maxWidth: 360 }}
          >
            {saving ? "Gemmer deltagere..." : "Gem deltagerliste"}
          </button>
        </>
      )}
    </section>
  );
}

function FlightAdmin({ season = ACTIVE_SEASON }) {
  const [rounds, setRounds] = useState([]);
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [selectedRound, setSelectedRound] = useState(null);
  const [flights, setFlights] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [newFlight, setNewFlight] = useState({
    flightNumber: "",
    name: "",
    teeTime: "",
  });
  const [loading, setLoading] = useState(true);
  const [savingFlightId, setSavingFlightId] = useState(null);
  const [creatingFlight, setCreatingFlight] = useState(false);
  const [savingStartList, setSavingStartList] = useState(false);
  const [assigningMarkers, setAssigningMarkers] = useState(false);
  const [publishingRound, setPublishingRound] = useState(false);
  const [startingLiveScoring, setStartingLiveScoring] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadRounds() {
      setLoading(true);
      try {
        setRounds(await getSeasonRoundsForFlights(season));
      } catch (error) {
        console.error("Fejl ved hentning af runder til bolde:", error);
        setErrorMessage(error.message ?? "Runderne kunne ikke hentes.");
      } finally {
        setLoading(false);
      }
    }
    loadRounds();
  }, [season]);

  async function loadFlightData(roundId) {
    if (!roundId) return;
    setLoading(true);
    setMessage("");
    setErrorMessage("");

    try {
      const result = await getFlightAdminData({ season, roundId });
      setSelectedRound(result.round);
      setFlights(result.flights);
      setParticipants(result.registeredParticipants);

      const nextDrafts = {};
      result.flights.forEach((flight) => {
        nextDrafts[flight.id] = {
          name: flight.name,
          flightNumber: flight.flight_number,
          teeTime: flight.tee_time?.slice(0, 5) ?? "",
          playerIds: [0, 1, 2, 3].map(
            (index) => flight.players[index]?.playerId ?? ""
          ),
        };
      });
      setDrafts(nextDrafts);
    } catch (error) {
      console.error("Fejl ved hentning af bolde:", error);
      setErrorMessage(error.message ?? "Boldene kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectRound(roundId) {
    setSelectedRoundId(roundId);
    setSelectedRound(null);
    setFlights([]);
    setParticipants([]);
    setDrafts({});
    if (roundId) await loadFlightData(roundId);
  }

  function updateDraft(flightId, field, value) {
    setDrafts((current) => ({
      ...current,
      [flightId]: { ...current[flightId], [field]: value },
    }));
    setMessage("");
    setErrorMessage("");
  }

  function updatePlayerSlot(flightId, slotIndex, playerId) {
    setDrafts((current) => {
      const playerIds = [...current[flightId].playerIds];
      playerIds[slotIndex] = playerId;
      return {
        ...current,
        [flightId]: { ...current[flightId], playerIds },
      };
    });
    setMessage("");
    setErrorMessage("");
  }

  const selectedPlayerIds = new Set(
    Object.values(drafts).flatMap((draft) => draft.playerIds.filter(Boolean))
  );

  const summary = summarizeFlightSetup({
    flights: flights.map((flight) => ({
      ...flight,
      players: (drafts[flight.id]?.playerIds ?? [])
        .filter(Boolean)
        .map((playerId) => ({ playerId })),
    })),
    registeredParticipants: participants,
  });

  const isLocked = Boolean(selectedRound?.locked_at);

  async function handleCreateFlight(event) {
    event.preventDefault();
    if (!selectedRoundId) return;
    setCreatingFlight(true);
    setMessage("");
    setErrorMessage("");

    try {
      const created = await createFlight({
        roundId: selectedRoundId,
        flightNumber: newFlight.flightNumber,
        name: newFlight.name,
        teeTime: newFlight.teeTime,
      });
      setNewFlight({ flightNumber: "", name: "", teeTime: "" });
      setMessage(`${created.name} er oprettet.`);
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved oprettelse af bold:", error);
      setErrorMessage(error.message ?? "Bolden kunne ikke oprettes.");
    } finally {
      setCreatingFlight(false);
    }
  }

  async function handleSaveFlight(flightId) {
    const draft = drafts[flightId];
    if (!draft) return;
    setSavingFlightId(flightId);
    setMessage("");
    setErrorMessage("");

    try {
      const saved = await updateFlight({
        flightId,
        name: draft.name,
        flightNumber: draft.flightNumber,
        teeTime: draft.teeTime,
      });
      setMessage(`${saved.name} er gemt.`);
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved gemning af bold:", error);
      setErrorMessage(error.message ?? "Bolden kunne ikke gemmes.");
    } finally {
      setSavingFlightId(null);
    }
  }

  async function handleDeleteFlight(flight) {
    const draft = drafts[flight.id];
    if (draft?.playerIds.some(Boolean)) {
      setErrorMessage("Fjern spillerne og gem startlisten, før bolden slettes.");
      return;
    }
    if (!window.confirm(`Vil du slette ${flight.name}?`)) return;

    setSavingFlightId(flight.id);
    try {
      await deleteEmptyFlight(flight.id);
      setMessage(`${flight.name} er slettet.`);
      await loadFlightData(selectedRoundId);
    } catch (error) {
      setErrorMessage(error.message ?? "Bolden kunne ikke slettes.");
    } finally {
      setSavingFlightId(null);
    }
  }

  async function handleSaveStartList() {
    setSavingStartList(true);
    setMessage("");
    setErrorMessage("");

    try {
      const allIds = Object.values(drafts).flatMap((draft) =>
        draft.playerIds.filter(Boolean)
      );
      if (new Set(allIds).size !== allIds.length) {
        throw new Error("En spiller er valgt i flere bolde.");
      }

      await saveFlightPlayers({
        roundId: selectedRoundId,
        flights: flights.map((flight) => ({
          flightId: flight.id,
          playerIds: drafts[flight.id]?.playerIds ?? [],
        })),
      });
      setMessage("Startlisten er gemt.");
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved gemning af startliste:", error);
      setErrorMessage(error.message ?? "Startlisten kunne ikke gemmes.");
    } finally {
      setSavingStartList(false);
    }
  }

  async function handleAssignMarkers() {
    if (!selectedRoundId || flights.length === 0) return;

    const missingNumbers = flights
      .map((flight) => Number(drafts[flight.id]?.flightNumber))
      .filter((flightNumber) => !Number.isInteger(flightNumber));

    if (missingNumbers.length > 0) {
      setErrorMessage("Alle bolde skal have et gyldigt boldnummer først.");
      return;
    }

    const confirmed = window.confirm(
      "Vil du tilknytte bold-login automatisk ud fra boldnumrene?"
    );
    if (!confirmed) return;

    setAssigningMarkers(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "assign_round_markers",
        { requested_round_id: selectedRoundId }
      );

      if (error) throw error;

      setMessage(`${data ?? 0} markørlogin er tilknyttet.`);
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved tilknytning af markørlogin:", error);
      setErrorMessage(
        error.message ?? "Markørlogin kunne ikke tilknyttes."
      );
    } finally {
      setAssigningMarkers(false);
    }
  }

  async function handleValidateAndPublishRound() {
    if (!selectedRoundId) return;

    const confirmed = window.confirm(
      "Vil du validere hele rundeopsætningen og publicere runden som klar?"
    );
    if (!confirmed) return;

    setPublishingRound(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "validate_and_publish_round",
        { requested_round_id: selectedRoundId }
      );

      if (error) throw error;

      setMessage(
        `Runden er publiceret som klar. ${data?.registered_players ?? 0} spillere, ${data?.flights ?? 0} bolde og ${data?.marker_logins ?? 0} markørlogin er valideret.`
      );
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved validering og publicering:", error);
      setErrorMessage(
        error.message ?? "Runden kunne ikke valideres og publiceres."
      );
    } finally {
      setPublishingRound(false);
    }
  }

  async function handleStartLiveScoring() {
    if (!selectedRoundId || selectedRound?.status !== "ready") return;

    const confirmed = window.confirm(
      `Vil du starte livescoring for Runde ${selectedRound.round_number}? Runden bliver synlig som LIVE på forsiden.`
    );
    if (!confirmed) return;

    setStartingLiveScoring(true);
    setMessage("");
    setErrorMessage("");

    try {
      const updatedRound = await updateRoundStatus({
        roundId: selectedRoundId,
        status: "live",
      });

      setMessage(
        `Livescoring er startet for Runde ${updatedRound.round_number}. Runden vises nu som LIVE på forsiden.`
      );
      await loadFlightData(selectedRoundId);
    } catch (error) {
      console.error("Fejl ved start af livescoring:", error);
      setErrorMessage(
        error.message ?? "Livescoring kunne ikke startes."
      );
    } finally {
      setStartingLiveScoring(false);
    }
  }

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #d8e4db",
        borderRadius: 16,
        background: "#ffffff",
      }}
    >
      <p className="eyebrow">TGT {season}</p>
      <h2 style={{ marginTop: 0 }}>Boldadministration</h2>
      <p className="description">
        Opret bolde, angiv starttider og placér kun de tilmeldte spillere.
        Rækkefølgen i felterne bliver spillerens spilleorden.
      </p>

      <select
        value={selectedRoundId}
        onChange={(event) => handleSelectRound(event.target.value)}
        className="form-input"
        style={{ maxWidth: 560 }}
      >
        <option value="">Vælg runde</option>
        {rounds.map((round) => (
          <option key={round.id} value={round.id}>
            Runde {round.round_number} · {round.name}
          </option>
        ))}
      </select>

      {loading && <div className="status-box">Henter boldopsætning...</div>}

      {errorMessage && (
        <div className="error-box" style={{ margin: "18px 0 0" }}>
          {errorMessage}
        </div>
      )}

      {message && (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 10,
            background: "#e7f6eb",
            color: "#176334",
            fontWeight: 700,
          }}
        >
          {message}
        </div>
      )}

      {!loading && selectedRound && (
        <>
          <div className="flight-information" style={{ marginTop: 18 }}>
            <div><span>Bolde</span><strong>{summary.totalFlights}</strong></div>
            <div><span>Tilmeldte</span><strong>{summary.registeredPlayers}</strong></div>
            <div><span>Placerede</span><strong>{selectedPlayerIds.size}</strong></div>
            <div><span>Uplacerede</span><strong>{summary.unassignedPlayers.length}</strong></div>
            <div><span>Mangler starttid</span><strong>{summary.flightsWithoutTeeTime}</strong></div>
            <div><span>Rundestatus</span><strong>{selectedRound.status}</strong></div>
          </div>

          {summary.unassignedPlayers.length > 0 && (
            <div className="status-box" style={{ margin: "18px 0 0" }}>
              <strong>Uplacerede spillere:</strong>{" "}
              {summary.unassignedPlayers
                .map((participant) => participant.playerName)
                .join(", ")}
            </div>
          )}

          {isLocked && (
            <div className="error-box" style={{ margin: "18px 0 0" }}>
              Runden er låst. Boldopsætningen kan ikke ændres.
            </div>
          )}

          <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
            {flights.map((flight) => {
              const draft = drafts[flight.id];
              if (!draft) return null;

              return (
                <article
                  key={flight.id}
                  style={{
                    padding: 16,
                    border: "1px solid #e1e8e3",
                    borderRadius: 14,
                    background: "#fafbf9",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px 1fr 150px",
                      gap: 10,
                    }}
                  >
                    <input
                      type="number"
                      min="1"
                      value={draft.flightNumber}
                      onChange={(event) =>
                        updateDraft(flight.id, "flightNumber", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    />
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        updateDraft(flight.id, "name", event.target.value)
                      }
                      className="form-input"
                      placeholder="Boldnavn"
                      disabled={isLocked}
                    />
                    <input
                      type="time"
                      value={draft.teeTime}
                      onChange={(event) =>
                        updateDraft(flight.id, "teeTime", event.target.value)
                      }
                      className="form-input"
                      disabled={isLocked}
                    />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(150px, 1fr))",
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
                    {draft.playerIds.map((playerId, slotIndex) => (
                      <select
                        key={slotIndex}
                        value={playerId}
                        onChange={(event) =>
                          updatePlayerSlot(
                            flight.id,
                            slotIndex,
                            event.target.value
                          )
                        }
                        className="form-input"
                        disabled={isLocked}
                      >
                        <option value="">Plads {slotIndex + 1}</option>
                        {participants.map((participant) => {
                          const usedElsewhere =
                            selectedPlayerIds.has(participant.playerId) &&
                            participant.playerId !== playerId;
                          return (
                            <option
                              key={participant.playerId}
                              value={participant.playerId}
                              disabled={usedElsewhere}
                            >
                              {participant.playerName}
                            </option>
                          );
                        })}
                      </select>
                    ))}
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      padding: 10,
                      borderRadius: 10,
                      background:
                        flight.markers?.length > 0 ? "#e7f6eb" : "#fff4dd",
                      color:
                        flight.markers?.length > 0 ? "#176334" : "#0b6543",
                      fontWeight: 700,
                    }}
                  >
                    {flight.markers?.length > 0
                      ? `Markørlogin tilknyttet: bold${draft.flightNumber}@tgt.dk`
                      : `Markørlogin mangler: bold${draft.flightNumber}@tgt.dk`}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleDeleteFlight(flight)}
                      disabled={isLocked || savingFlightId === flight.id}
                      className="login-cancel-button"
                      style={{ width: "auto", marginTop: 0 }}
                    >
                      Slet tom bold
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveFlight(flight.id)}
                      disabled={isLocked || savingFlightId === flight.id}
                      className="login-submit-button"
                      style={{ width: "auto", marginTop: 0 }}
                    >
                      {savingFlightId === flight.id ? "Gemmer..." : "Gem bold"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSaveStartList}
            disabled={isLocked || savingStartList || flights.length === 0}
            className="login-submit-button"
            style={{ maxWidth: 360 }}
          >
            {savingStartList ? "Gemmer startliste..." : "Gem hele startlisten"}
          </button>

          <button
            type="button"
            onClick={handleAssignMarkers}
            disabled={isLocked || assigningMarkers || flights.length === 0}
            className="login-submit-button"
            style={{ maxWidth: 360, marginLeft: 10 }}
          >
            {assigningMarkers
              ? "Tilknytter markørlogin..."
              : "Tilknyt markørlogin"}
          </button>

          <button
            type="button"
            onClick={handleValidateAndPublishRound}
            disabled={
              isLocked ||
              publishingRound ||
              flights.length === 0 ||
              selectedRound.status === "ready"
            }
            className="login-submit-button"
            style={{ maxWidth: 360, marginLeft: 10 }}
          >
            {publishingRound
              ? "Validerer og publicerer..."
              : selectedRound.status === "ready"
                ? "Runden er publiceret"
                : "Validér og publicér runde"}
          </button>

          <button
            type="button"
            onClick={handleStartLiveScoring}
            disabled={
              isLocked ||
              startingLiveScoring ||
              selectedRound.status !== "ready"
            }
            className="login-submit-button"
            style={{
              maxWidth: 360,
              marginLeft: 10,
              background:
                selectedRound.status === "live" ? "#176334" : undefined,
            }}
          >
            {startingLiveScoring
              ? "Starter livescoring..."
              : selectedRound.status === "live"
                ? "Livescoring er i gang"
                : "Start livescoring"}
          </button>

          <form
            onSubmit={handleCreateFlight}
            style={{
              marginTop: 26,
              paddingTop: 22,
              borderTop: "1px solid #e1e8e3",
            }}
          >
            <p className="eyebrow">Ny startgruppe</p>
            <h3 style={{ margin: "5px 0 14px" }}>Opret bold</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "110px 1fr 150px",
                gap: 10,
              }}
            >
              <input
                type="number"
                min="1"
                value={newFlight.flightNumber}
                onChange={(event) =>
                  setNewFlight((current) => ({
                    ...current,
                    flightNumber: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Nr."
                required
              />
              <input
                value={newFlight.name}
                onChange={(event) =>
                  setNewFlight((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="form-input"
                placeholder="Boldnavn, fx Bold 1"
              />
              <input
                type="time"
                value={newFlight.teeTime}
                onChange={(event) =>
                  setNewFlight((current) => ({
                    ...current,
                    teeTime: event.target.value,
                  }))
                }
                className="form-input"
              />
            </div>
            <button
              type="submit"
              disabled={isLocked || creatingFlight}
              className="login-submit-button"
              style={{ maxWidth: 300 }}
            >
              {creatingFlight ? "Opretter..." : "Opret bold"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}


function CourseDatabaseAdmin() {
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [tees, setTees] = useState([]);
  const [holes, setHoles] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingLubker, setImportingLubker] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [newCourse, setNewCourse] = useState({ clubName: "", courseName: "" });
  const [newTee, setNewTee] = useState({ teeName: "", courseRating: "", slopeRating: "", totalLength: "" });
  const [csvRows, setCsvRows] = useState([]);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const filteredCourses = courses.filter((course) =>
    `${course.club_name} ${course.course_name}`.toLowerCase().includes(search.trim().toLowerCase())
  );

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    const { data, error } = await supabase
      .from("courses")
      .select("id, club_name, course_name")
      .order("club_name", { ascending: true })
      .order("course_name", { ascending: true });
    if (error) setErrorMessage(error.message);
    else setCourses(data ?? []);
    setLoading(false);
  }, []);

  const loadCourseDetails = useCallback(async (courseId) => {
    if (!courseId) {
      setTees([]);
      setHoles([]);
      return;
    }
    setErrorMessage("");
    const [teeResult, holeResult] = await Promise.all([
      supabase.from("course_tees").select("id, tee_name, course_rating, slope_rating, total_length_meters").eq("course_id", courseId).order("tee_name"),
      supabase.from("course_holes").select("id, hole_number, par, stroke_index").eq("course_id", courseId).order("hole_number"),
    ]);
    if (teeResult.error) setErrorMessage(teeResult.error.message);
    else setTees(teeResult.data ?? []);
    if (holeResult.error) setErrorMessage(holeResult.error.message);
    else setHoles(holeResult.data ?? []);
  }, []);

  useEffect(() => { loadCourses(); }, [loadCourses]);
  useEffect(() => { loadCourseDetails(selectedCourseId); }, [selectedCourseId, loadCourseDetails]);

  async function createCourse(event) {
    event.preventDefault();
    if (!newCourse.clubName.trim() || !newCourse.courseName.trim()) return;
    setSaving(true); setMessage(""); setErrorMessage("");
    const { data, error } = await supabase.from("courses").insert({
      club_name: newCourse.clubName.trim(),
      course_name: newCourse.courseName.trim(),
    }).select("id, club_name, course_name").single();
    if (error) setErrorMessage(error.message);
    else {
      setMessage(`${data.club_name} · ${data.course_name} er oprettet.`);
      setNewCourse({ clubName: "", courseName: "" });
      await loadCourses();
      setSelectedCourseId(data.id);
    }
    setSaving(false);
  }

  async function createTee(event) {
    event.preventDefault();
    if (!selectedCourseId || !newTee.teeName.trim()) return;
    setSaving(true); setMessage(""); setErrorMessage("");
    const { error } = await supabase.from("course_tees").insert({
      course_id: selectedCourseId,
      tee_name: newTee.teeName.trim(),
      course_rating: newTee.courseRating === "" ? null : Number(newTee.courseRating),
      slope_rating: newTee.slopeRating === "" ? null : Number(newTee.slopeRating),
      total_length_meters: newTee.totalLength === "" ? null : Number(newTee.totalLength),
    });
    if (error) setErrorMessage(error.message);
    else {
      setMessage(`Tee ${newTee.teeName.trim()} er oprettet.`);
      setNewTee({ teeName: "", courseRating: "", slopeRating: "", totalLength: "" });
      await loadCourseDetails(selectedCourseId);
    }
    setSaving(false);
  }

  async function saveHoles() {
    if (!selectedCourseId) return;
    setSaving(true); setMessage(""); setErrorMessage("");
    const payload = holes.map((hole) => ({
      id: hole.id,
      course_id: selectedCourseId,
      hole_number: Number(hole.hole_number),
      par: Number(hole.par),
      stroke_index: Number(hole.stroke_index),
    }));
    const { error } = await supabase.from("course_holes").upsert(payload);
    if (error) setErrorMessage(error.message);
    else setMessage("Huldata er gemt.");
    setSaving(false);
  }

  function prepare18Holes() {
    setHoles(Array.from({ length: 18 }, (_, index) => {
      const existing = holes.find((hole) => Number(hole.hole_number) === index + 1);
      return existing ?? { course_id: selectedCourseId, hole_number: index + 1, par: 4, stroke_index: index + 1 };
    }));
  }

  function parseCsv(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const separator = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(separator).map((value) => value.trim().toLowerCase());
    return lines.slice(1).map((line) => {
      const values = line.split(separator).map((value) => value.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
  }

  async function handleCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvRows(parseCsv(await file.text()));
    setMessage(`${file.name} er indlæst og klar til import.`);
  }

  async function importCsv() {
    if (csvRows.length === 0) return;
    setSaving(true); setMessage(""); setErrorMessage("");
    try {
      const groups = new Map();
      csvRows.forEach((row) => {
        const club = row.club_name?.trim();
        const course = row.course_name?.trim();
        if (!club || !course) return;
        const key = `${club}|||${course}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      });
      let importedCourses = 0;
      for (const [key, rows] of groups.entries()) {
        const [clubName, courseName] = key.split("|||");
        let course = courses.find((item) => item.club_name === clubName && item.course_name === courseName);
        if (!course) {
          const result = await supabase.from("courses").insert({ club_name: clubName, course_name: courseName }).select("id, club_name, course_name").single();
          if (result.error) throw result.error;
          course = result.data;
        }
        importedCourses += 1;
        const holePayload = rows.filter((row) => row.hole_number).map((row) => ({
          course_id: course.id,
          hole_number: Number(row.hole_number),
          par: Number(row.par || 4),
          stroke_index: Number(row.stroke_index || row.hole_number),
        }));
        if (holePayload.length) {
          const existing = await supabase.from("course_holes").select("id, hole_number").eq("course_id", course.id);
          if (existing.error) throw existing.error;
          const ids = new Map((existing.data ?? []).map((hole) => [Number(hole.hole_number), hole.id]));
          const result = await supabase.from("course_holes").upsert(holePayload.map((hole) => ({ ...hole, ...(ids.get(hole.hole_number) ? { id: ids.get(hole.hole_number) } : {}) })));
          if (result.error) throw result.error;
        }
        const teeNames = [...new Set(rows.map((row) => row.tee_name).filter(Boolean))];
        for (const teeName of teeNames) {
          const teeRow = rows.find((row) => row.tee_name === teeName);
          const existingTee = await supabase.from("course_tees").select("id").eq("course_id", course.id).eq("tee_name", teeName).maybeSingle();
          if (existingTee.error) throw existingTee.error;
          const teePayload = {
            course_id: course.id,
            tee_name: teeName,
            course_rating: teeRow.course_rating ? Number(teeRow.course_rating.replace(",", ".")) : null,
            slope_rating: teeRow.slope_rating ? Number(teeRow.slope_rating) : null,
            total_length_meters: teeRow.total_length_meters ? Number(teeRow.total_length_meters) : null,
          };
          const teeResult = existingTee.data?.id
            ? await supabase.from("course_tees").update(teePayload).eq("id", existingTee.data.id).select("id").single()
            : await supabase.from("course_tees").insert(teePayload).select("id").single();
          if (teeResult.error) throw teeResult.error;
        }
      }
      setMessage(`${importedCourses} baneudgaver er importeret eller opdateret.`);
      setCsvRows([]);
      await loadCourses();
    } catch (error) {
      setErrorMessage(error.message ?? "CSV-importen kunne ikke gennemføres.");
    } finally {
      setSaving(false);
    }
  }

  async function importLubkerFinalCourses() {
    setImportingLubker(true); setMessage(""); setErrorMessage("");
    try {
      for (const preset of LUBKER_FINAL_COURSES) {
        const found = await supabase.from("courses").select("id").eq("club_name", preset.clubName).eq("course_name", preset.courseName).maybeSingle();
        if (found.error) throw found.error;
        let courseId = found.data?.id;
        if (!courseId) {
          const created = await supabase.from("courses").insert({ club_name: preset.clubName, course_name: preset.courseName }).select("id").single();
          if (created.error) throw created.error;
          courseId = created.data.id;
        }
        const existingHoles = await supabase.from("course_holes").select("id, hole_number").eq("course_id", courseId);
        if (existingHoles.error) throw existingHoles.error;
        const holeIds = new Map((existingHoles.data ?? []).map((hole) => [Number(hole.hole_number), hole.id]));
        const savedHoles = await supabase.from("course_holes").upsert(preset.holes.map(([holeNumber, par, strokeIndex]) => ({ ...(holeIds.get(holeNumber) ? { id: holeIds.get(holeNumber) } : {}), course_id: courseId, hole_number: holeNumber, par, stroke_index: strokeIndex })));
        if (savedHoles.error) throw savedHoles.error;
        for (const [teeName, courseRating, slopeRating, totalLength] of preset.tees) {
          const foundTee = await supabase.from("course_tees").select("id").eq("course_id", courseId).eq("tee_name", teeName).maybeSingle();
          if (foundTee.error) throw foundTee.error;
          const payload = { course_id: courseId, tee_name: teeName, course_rating: courseRating, slope_rating: slopeRating, total_length_meters: totalLength };
          const savedTee = foundTee.data?.id ? await supabase.from("course_tees").update(payload).eq("id", foundTee.data.id) : await supabase.from("course_tees").insert(payload);
          if (savedTee.error) throw savedTee.error;
        }
      }
      setMessage("Lübker Sand/Forest og Sand/Sky er klar i banedatabasen.");
      await loadCourses();
    } catch (error) { setErrorMessage(error.message ?? "Lübker-banerne kunne ikke importeres."); }
    finally { setImportingLubker(false); }
  }

  return (
    <section className="tgt-course-database">
      <header className="tgt-course-db-header">
        <div><p className="eyebrow">Permanent TGT-register</p><h2>Banedatabase</h2><p className="description">Opret, søg og genbrug klubber, baner, tees og huldata på tværs af alle sæsoner.</p></div>
        <div className="tgt-course-db-count"><span>Baner</span><strong>{courses.length}</strong></div>
      </header>
      <section style={{ marginTop: 18, padding: 18, border: "1px solid rgba(22,132,84,.38)", borderRadius: 16, background: "#f7faf7", textAlign: "center" }}>
        <p className="eyebrow">Finalebaner 2026</p><h3 style={{ margin: "5px 0 8px" }}>Lübker-konverteringstabeller</h3>
        <p className="description" style={{ marginBottom: 14 }}>Importerer eller opdaterer Sand/Forest og Sand/Sky med tees, CR, slope, par og stroke index.</p>
        <button type="button" className="login-submit-button" onClick={importLubkerFinalCourses} disabled={saving || importingLubker} style={{ maxWidth: 420, margin: "0 auto" }}>{importingLubker ? "Importerer Lübker..." : "Importér Lübker Sand/Forest og Sand/Sky"}</button>
      </section>
      {message && <div className="status-box">{message}</div>}
      {errorMessage && <div className="error-box"><strong>Banedatabasen kunne ikke opdateres</strong><span>{errorMessage}</span></div>}
      <div className="tgt-course-db-layout">
        <aside className="tgt-course-db-sidebar">
          <input className="form-input" type="search" placeholder="Søg klub eller bane..." value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="tgt-course-list">
            {loading ? <div className="status-box">Henter baner...</div> : filteredCourses.map((course) => (
              <button type="button" key={course.id} className={selectedCourseId === course.id ? "active" : ""} onClick={() => setSelectedCourseId(course.id)}>
                <strong>{course.club_name}</strong><span>{course.course_name}</span>
              </button>
            ))}
          </div>
          <form onSubmit={createCourse} className="tgt-course-form">
            <h3>Ny bane</h3>
            <input className="form-input" placeholder="Golfklub" value={newCourse.clubName} onChange={(event) => setNewCourse((current) => ({ ...current, clubName: event.target.value }))} />
            <input className="form-input" placeholder="Bane eller kombination" value={newCourse.courseName} onChange={(event) => setNewCourse((current) => ({ ...current, courseName: event.target.value }))} />
            <button className="login-submit-button" disabled={saving}>Opret bane</button>
          </form>
        </aside>
        <div className="tgt-course-db-main">
          {!selectedCourse ? <div className="status-box">Vælg en bane i listen, eller opret en ny.</div> : <>
            <div className="tgt-course-title"><p className="eyebrow">Valgt bane</p><h3>{selectedCourse.club_name}</h3><span>{selectedCourse.course_name}</span></div>
            <form onSubmit={createTee} className="tgt-course-form tgt-tee-form">
              <h3>Tilføj tee</h3>
              <input className="form-input" placeholder="Tee-navn, fx 58" value={newTee.teeName} onChange={(event) => setNewTee((current) => ({ ...current, teeName: event.target.value }))} />
              <input className="form-input" inputMode="decimal" placeholder="Course Rating" value={newTee.courseRating} onChange={(event) => setNewTee((current) => ({ ...current, courseRating: event.target.value }))} />
              <input className="form-input" inputMode="numeric" placeholder="Slope Rating" value={newTee.slopeRating} onChange={(event) => setNewTee((current) => ({ ...current, slopeRating: event.target.value }))} />
              <input className="form-input" inputMode="numeric" placeholder="Samlet længde i meter" value={newTee.totalLength} onChange={(event) => setNewTee((current) => ({ ...current, totalLength: event.target.value }))} />
              <button className="login-submit-button" disabled={saving}>Gem tee</button>
            </form>
            <div className="tgt-tee-grid">{tees.map((tee) => <article key={tee.id}><span>TEE</span><strong>{tee.tee_name}</strong><small>CR {tee.course_rating ?? "–"} · Slope {tee.slope_rating ?? "–"}</small><small>{tee.total_length_meters ? `${tee.total_length_meters} m` : "Længde mangler"}</small></article>)}</div>
            <section className="tgt-hole-editor">
              <div className="tgt-hole-editor-head"><div><p className="eyebrow">Scorekort</p><h3>Par og stroke index</h3></div><button type="button" className="login-cancel-button" onClick={prepare18Holes}>Klargør 18 huller</button></div>
              <div className="tgt-hole-grid">{holes.map((hole, index) => <label key={hole.id ?? hole.hole_number}><span>Hul {hole.hole_number}</span><input type="number" min="3" max="6" value={hole.par} onChange={(event) => setHoles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, par: event.target.value } : item))} /><small>Par</small><input type="number" min="1" max="18" value={hole.stroke_index} onChange={(event) => setHoles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, stroke_index: event.target.value } : item))} /><small>Index</small></label>)}</div>
              {holes.length > 0 && <button type="button" className="login-submit-button" onClick={saveHoles} disabled={saving}>Gem huldata</button>}
            </section>
          </>}
          <section className="tgt-csv-import">
            <p className="eyebrow">Masseimport</p><h3>Importér baner fra CSV</h3>
            <p className="description">Kolonner: club_name, course_name, hole_number, par, stroke_index, tee_name, length_meters, course_rating, slope_rating, total_length_meters.</p>
            <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} />
            {csvRows.length > 0 && <button type="button" className="login-submit-button" onClick={importCsv} disabled={saving}>Importér {csvRows.length} rækker</button>}
          </section>
        </div>
      </div>
    </section>
  );
}

function AdminClosestToPin({ session, onLogout }) {
  const [roundId, setRoundId] = useState(null);
  const [roundLocks, setRoundLocks] = useState([]);
  const [changingRoundId, setChangingRoundId] = useState(null);
  const [seasonArchive, setSeasonArchive] = useState(null);
  const [finalizingSeason, setFinalizingSeason] = useState(false);
  const [season2027, setSeason2027] = useState(null);
  const [season2027PlayerCount, setSeason2027PlayerCount] = useState(0);
  const [creatingSeason2027, setCreatingSeason2027] = useState(false);
  const [approvedWinners, setApprovedWinners] = useState([]);
  const [finalPreview, setFinalPreview] = useState(null);
  const [previewValidation, setPreviewValidation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [creatingFlights, setCreatingFlights] = useState(false);
  const [flightsCreated, setFlightsCreated] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [adminSeasonTab, setAdminSeasonTab] = useState(String(ACTIVE_SEASON));
  const [adminSection, setAdminSection] = useState("overview");
  const [regularSeasonPreview, setRegularSeasonPreview] = useState([]);
  const [regularSeasonArchive, setRegularSeasonArchive] = useState([]);
  const [finalizingIndividualRegularSeason, setFinalizingIndividualRegularSeason] = useState(false);
  const [teamRegularSeasonArchive, setTeamRegularSeasonArchive] = useState([]);
  const [regularSeasonTeamPreview, setRegularSeasonTeamPreview] = useState([]);
  const [finalizingTeamRegularSeason, setFinalizingTeamRegularSeason] = useState(false);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: round, error: roundError } = await supabase
        .from("rounds")
        .select(`
          id,
          tournament_id,
          round_number,
          name,
          played_at,
          round_type,
          locked_at,
          locked_by,
          tournaments!inner (
            season
          )
        `)
        .eq("tournaments.season", 2026)
        .in("round_type", ["team_final", "individual_final"])
        .order("round_number", { ascending: true });

      if (roundError) throw roundError;

      const rounds = round ?? [];
      setRoundLocks(rounds);

      const teamFinalRound = rounds.find(
        (item) => item.round_type === "team_final"
      );

      setRoundId(teamFinalRound?.id ?? null);

      if (teamFinalRound?.tournament_id) {
        const { data: archive, error: archiveError } = await supabase
          .from("season_champions")
          .select(`
            id,
            season,
            individual_champion_name,
            individual_score,
            team_champion_name,
            finalized_at
          `)
          .eq("tournament_id", teamFinalRound.tournament_id)
          .maybeSingle();

        if (archiveError) throw archiveError;
        setSeasonArchive(archive);
      } else {
        setSeasonArchive(null);
      }

      const { data: nextSeason, error: nextSeasonError } = await supabase
        .from("tournaments")
        .select(`
          id,
          name,
          season,
          status,
          is_public,
          locked_at
        `)
        .eq("season", 2027)
        .maybeSingle();

      if (nextSeasonError) throw nextSeasonError;
      setSeason2027(nextSeason);

      if (nextSeason?.id) {
        const { count, error: playerCountError } = await supabase
          .from("players")
          .select("id", { count: "exact", head: true })
          .eq("tournament_id", nextSeason.id)
          .eq("active", true);

        if (playerCountError) throw playerCountError;
        setSeason2027PlayerCount(count ?? 0);
      } else {
        setSeason2027PlayerCount(0);
      }

      if (teamFinalRound?.id) {
        const { data: winners, error: winnersError } = await supabase
          .from("closest_to_pin")
          .select(`
            id,
            hole_number,
            distance_meters,
            bonus_strokes,
            approved,
            players (
              id,
              name
            )
          `)
          .eq("round_id", teamFinalRound.id)
          .eq("approved", true)
          .order("hole_number", { ascending: true });

        if (winnersError) throw winnersError;
        setApprovedWinners(winners ?? []);
      } else {
        setApprovedWinners([]);
      }
    } catch (error) {
      console.error("Fejl ved hentning af admindata:", error);
      setErrorMessage(
        error.message ?? "Admindata kunne ikke hentes."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);
  useEffect(() => {
    if (adminSection !== "season_center") return;
    loadRegularSeasonFinaleCenter().catch((error) => {
      console.error("Sæsoncenter kunne ikke hentes:", error);
      setErrorMessage(error.message ?? "Sæsoncenter kunne ikke hentes.");
    });
  }, [adminSeasonTab, adminSection]);

  async function loadRegularSeasonFinaleCenter() {
    const [previewResult, archiveResult, individualRoundsResult, teamRoundsResult, teamArchiveResult] = await Promise.all([
      supabase.from("season_individual_standings").select("player_id, player_name, counting_rounds, counting_score, halved_score").eq("season",Number(adminSeasonTab)),
      supabase.from("season_regular_standings").select("player_id, player_name, counting_score, halved_score, finalized_at").eq("season",Number(adminSeasonTab)).order("position",{ascending:true}),
      supabase.from("round_results").select("player_id,score,tournaments!inner(season)").eq("tournaments.season",Number(adminSeasonTab)).not("score","is",null),
      supabase.from("team_round_results").select("team_id,score,tournaments!inner(season)").eq("tournaments.season",Number(adminSeasonTab)).not("score","is",null),
      supabase.from("season_team_regular_standings").select("team_id,team_name,counting_score,halved_score,finalized_at").eq("season",Number(adminSeasonTab)).order("position",{ascending:true}),
    ]);
    if(previewResult.error)throw previewResult.error;
    if(archiveResult.error&&archiveResult.error.code!=="42P01")throw archiveResult.error;
    if(individualRoundsResult.error)throw individualRoundsResult.error;
    if(teamRoundsResult.error)throw teamRoundsResult.error;
    if(teamArchiveResult.error&&teamArchiveResult.error.code!=="42P01")throw teamArchiveResult.error;
    const scoresByPlayer={};
    (individualRoundsResult.data??[]).forEach((row)=>{(scoresByPlayer[row.player_id]??=[]).push(Number(row.score));});
    const scoresByTeam={};
    (teamRoundsResult.data??[]).forEach((row)=>{(scoresByTeam[row.team_id]??=[]).push(Number(row.score));});
    const teamPreviewRows=Object.entries(scoresByTeam).map(([teamId,scores])=>{
      const base=getManualFinalBase(scores);
      return {teamId,roundsPlayed:scores.length,countingScore:base.countingScore,halvedScore:base.halvedScore,eligible:base.eligible};
    }).sort((a,b)=>Number(a.countingScore??Infinity)-Number(b.countingScore??Infinity));
    const previewRows=(previewResult.data??[]).map((player)=>{
      const base=getManualFinalBase(scoresByPlayer[player.player_id]??[]);
      return {...player,counting_rounds:base.usedScores.length,counting_score:base.countingScore,halved_score:base.halvedScore,used_worst_twice:(scoresByPlayer[player.player_id]??[]).length===3};
    }).sort((a,b)=>Number(a.counting_score??Infinity)-Number(b.counting_score??Infinity));
    setRegularSeasonPreview(previewRows);
    setRegularSeasonArchive(archiveResult.data??[]);
    setRegularSeasonTeamPreview(teamPreviewRows);
    setTeamRegularSeasonArchive(teamArchiveResult.data??[]);
  }

  async function handleFinalizeIndividualRegularSeason() {
    const unqualified = regularSeasonPreview.filter((player) => Number(player.counting_rounds) < 3);
    if (unqualified.length > 0) {
      setErrorMessage(`${unqualified.length} spiller(e) mangler mindst tre tællende runder.`);
      return;
    }
    const confirmed = window.confirm(
      `${regularSeasonArchive.length>0?"Vil du genberegne":"Vil du halvere"} den individuelle score i TGT ${adminSeasonTab}? De fire bedste scorer bruges, og et tidligere finalegrundlag erstattes.`
    );
    if (!confirmed) return;
    setFinalizingIndividualRegularSeason(true);
    setMessage("");
    setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("finalize_regular_season", {
        requested_season: Number(adminSeasonTab),
      });
      if (error) throw error;
      setMessage(`Den individuelle finaleudregning er gemt. ${data ?? regularSeasonPreview.length} spilleres finalegrundlag er opdateret.`);
      await loadRegularSeasonFinaleCenter();
    } catch (error) {
      console.error("Fejl ved afslutning af grundspillet:", error);
      setErrorMessage(error.message ?? "Grundspillet kunne ikke afsluttes.");
    } finally {
      setFinalizingIndividualRegularSeason(false);
    }
  }

  async function handleFinalizeTeamRegularSeason() {
    const eligibleTeams=regularSeasonTeamPreview.filter((team)=>Number(team.roundsPlayed)>=3);
    if(eligibleTeams.length===0){setErrorMessage("Ingen hold har mindst tre gennemførte runder.");return;}
    const confirmed=window.confirm(`${teamRegularSeasonArchive.length>0?"Vil du genberegne":"Vil du halvere"} holdscorerne i TGT ${adminSeasonTab}? De fire bedste holdrunder tæller, og et tidligere finalegrundlag erstattes. Ved tre runder tæller den dårligste også som fjerde.`);
    if(!confirmed)return;
    setFinalizingTeamRegularSeason(true);setMessage("");setErrorMessage("");
    try{
      const {data,error}=await supabase.rpc("finalize_team_regular_season",{requested_season:Number(adminSeasonTab)});
      if(error)throw error;
      setMessage(`Holdenes finaleudregning er gemt. ${data??eligibleTeams.length} holds finalegrundlag er opdateret.`);
      await loadRegularSeasonFinaleCenter();
    }catch(error){console.error("Fejl ved halvering af holdscorer:",error);setErrorMessage(error.message??"Holdscorerne kunne ikke halveres.");}
    finally{setFinalizingTeamRegularSeason(false);}
  }

  async function handleRoundLock(roundData) {
    const isLocked = Boolean(roundData.locked_at);
    const actionText = isLocked ? "genåbne" : "låse";

    const confirmed = window.confirm(
      `Vil du ${actionText} Runde ${roundData.round_number}?`
    );

    if (!confirmed) return;

    setChangingRoundId(roundData.id);
    setMessage("");
    setErrorMessage("");

    try {
      const functionName = isLocked
        ? "unlock_tgt_round"
        : "lock_tgt_round";

      const { error } = await supabase.rpc(functionName, {
        requested_round_id: roundData.id,
      });

      if (error) throw error;

      setMessage(
        `Runde ${roundData.round_number} er ${
          isLocked ? "genåbnet" : "låst"
        }.`
      );
      await loadAdminData();
    } catch (error) {
      console.error("Fejl ved ændring af rundelås:", error);
      setErrorMessage(
        error.message ?? "Rundens låsestatus kunne ikke ændres."
      );
    } finally {
      setChangingRoundId(null);
    }
  }

  async function handleFinalizeClosestToPin() {
    if (!roundId) return;

    setFinalizing(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "finalize_closest_to_pin",
        { requested_round_id: roundId }
      );

      if (error) throw error;

      setMessage(
        `${data ?? 0} tættest-på-pinden-vindere er godkendt.`
      );
      await loadAdminData();
    } catch (error) {
      console.error("Fejl ved godkendelse af vindere:", error);
      setErrorMessage(
        error.message ?? "Vinderne kunne ikke godkendes."
      );
    } finally {
      setFinalizing(false);
    }
  }

  async function handleLoadFinalPreview() {
    setLoadingPreview(true);
    setMessage("");
    setErrorMessage("");

    try {
      const teamFinalRound = roundLocks.find(
        (roundData) => roundData.round_type === "team_final"
      );
      const individualFinalRound = roundLocks.find(
        (roundData) => roundData.round_type === "individual_final"
      );
      if (!teamFinalRound || !individualFinalRound) {
        throw new Error(
          "Opret både en holdfinale og en individuel finale under Runder først."
        );
      }
      const preview = await getFinalFlightsPreview({
        season: 2026,
        sourceRoundNumber: teamFinalRound.round_number,
        finalRoundNumber: individualFinalRound.round_number,
      });

      setFinalPreview(preview);
      setPreviewValidation(
        validateFinalFlightsPreview(preview)
      );
    } catch (error) {
      console.error("Fejl ved forhåndsvisning af finalebolde:", error);
      setFinalPreview(null);
      setPreviewValidation(null);
      setErrorMessage(
        error.message ?? "Finaleboldene kunne ikke beregnes."
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleCreateFinalFlights() {
    if (
      !finalPreview?.finalRound?.id ||
      !previewValidation?.valid ||
      !finalPreview.canGenerate
    ) {
      setErrorMessage(
        "Finaleboldene kan ikke oprettes, før alle kontroller er godkendt."
      );
      return;
    }

    const confirmed = window.confirm(
      "Vil du oprette finaleboldene i Runde 7? En eksisterende fordeling i Runde 7 bliver erstattet."
    );

    if (!confirmed) return;

    setCreatingFlights(true);
    setFlightsCreated(false);
    setMessage("");
    setErrorMessage("");

    try {
      const assignments = finalPreview.flights.flatMap((flight) =>
        flight.players.map((player) => ({
          player_id: player.playerId,
          flight_number: flight.flightNumber,
          playing_order: player.playingOrder,
        }))
      );

      const { data, error } = await supabase.rpc(
        "create_final_flights",
        {
          requested_final_round_id: finalPreview.finalRound.id,
          assignments,
        }
      );

      if (error) throw error;

      setFlightsCreated(true);
      setMessage(
        `${data ?? 0} spillere er oprettet i finaleboldene på Runde 7.`
      );
    } catch (error) {
      console.error("Fejl ved oprettelse af finalebolde:", error);
      setErrorMessage(
        error.message ?? "Finaleboldene kunne ikke oprettes."
      );
    } finally {
      setCreatingFlights(false);
    }
  }

  async function handleCreateSeason2027() {
    const sourceSeason = ACTIVE_SEASON;
    const newSeason = ACTIVE_SEASON + 1;
    const confirmed = window.confirm(
      `Vil du oprette TGT ${newSeason} og automatisk kopiere aktive spillere, aktive hold og rundeopsætningen fra TGT ${sourceSeason}? Scores, bolde, deltagere og historiske resultater kopieres ikke.`
    );
    if (!confirmed) return;
    setCreatingSeason2027(true);
    setMessage("");
    setErrorMessage("");
    try {
      const { data: tournamentId, error } = await supabase.rpc("create_next_tgt_season", {
        source_season: sourceSeason,
        new_season: newSeason,
      });
      if (error) throw error;

      const { error: publishSeasonError } = await supabase
        .from("tournaments")
        .update({ is_public: true })
        .eq("season", newSeason);
      if (publishSeasonError) throw publishSeasonError;

      const [sourcePlayersResult, targetPlayersResult, sourceTeamsResult, targetTeamsResult, sourceRoundsResult, targetRoundsResult] = await Promise.all([
        getSeasonPlayers(sourceSeason),
        getSeasonPlayers(newSeason),
        getSeasonTeams(sourceSeason),
        getSeasonTeams(newSeason),
        getSeasonRounds(sourceSeason),
        getSeasonRounds(newSeason),
      ]);
      const sourcePlayers = sourcePlayersResult.players ?? [];
      const targetPlayers = targetPlayersResult.players ?? [];
      const targetPlayerByName = new Map(targetPlayers.map((player) => [String(player.name ?? "").trim().toLocaleLowerCase("da"), player]));
      const sourcePlayerById = new Map(sourcePlayers.map((player) => [String(player.id), player]));

      let copiedTeams = 0;
      const existingTeamNames = new Set((targetTeamsResult.teams ?? []).map((team) => String(team.name ?? "").trim().toLocaleLowerCase("da")));
      for (const team of (sourceTeamsResult.teams ?? []).filter((item) => item.active !== false)) {
        const teamKey = String(team.name ?? "").trim().toLocaleLowerCase("da");
        if (!teamKey || existingTeamNames.has(teamKey)) continue;
        const targetMemberIds = (team.members ?? []).map((member) => {
          const sourcePlayer = sourcePlayerById.get(String(member.playerId));
          return targetPlayerByName.get(String(sourcePlayer?.name ?? "").trim().toLocaleLowerCase("da"))?.id;
        }).filter(Boolean);
        if (targetMemberIds.length !== 2) throw new Error(`Holdet ${team.name} kunne ikke kopieres, fordi begge spillere ikke findes i TGT ${newSeason}.`);
        await createSeasonTeam({ season: newSeason, name: team.name, playerIds: targetMemberIds });
        existingTeamNames.add(teamKey);
        copiedTeams += 1;
      }

      let copiedRounds = 0;
      const existingRoundNumbers = new Set((targetRoundsResult.rounds ?? []).map((round) => Number(round.round_number)));
      for (const round of sourceRoundsResult.rounds ?? []) {
        if (existingRoundNumbers.has(Number(round.round_number))) continue;
        let playedAt = round.played_at ?? "";
        if (playedAt) {
          const date = new Date(`${playedAt}T12:00:00`);
          if (!Number.isNaN(date.getTime())) {
            date.setFullYear(date.getFullYear() + (newSeason - sourceSeason));
            playedAt = date.toISOString().slice(0, 10);
          }
        }
        const createdRound = await createSeasonRound({
          season: newSeason,
          roundNumber: round.round_number,
          name: round.name,
          playedAt,
          courseId: round.course_id ?? "",
          teeId: round.tee_id ?? "",
          roundType: round.round_type ?? "regular",
          individualEnabled: round.individual_enabled,
          teamEnabled: round.team_enabled,
          closestToPinEnabled: round.closest_to_pin_enabled,
        });
        const { error: liveModeError } = await supabase.from("rounds").update({ live_leaderboard_mode: round.live_leaderboard_mode ?? "none" }).eq("id", createdRound.id);
        if (liveModeError) throw liveModeError;
        existingRoundNumbers.add(Number(round.round_number));
        copiedRounds += 1;
      }

      setMessage(`TGT ${newSeason} er oprettet automatisk. ${targetPlayers.length} spillere, ${copiedTeams} nye hold og ${copiedRounds} nye runder er klar. Scores, deltagere og bolde er ikke kopieret.`);
      await loadAdminData();
    } catch (error) {
      console.error("Fejl ved automatisk sæsonoprettelse:", error);
      setErrorMessage(error.message ?? "Den nye TGT-sæson kunne ikke oprettes automatisk.");
    } finally {
      setCreatingSeason2027(false);
    }
  }

  async function handleFinalizeSeason() {
    const teamFinalRound = roundLocks.find(
      (roundData) => roundData.round_type === "team_final"
    );
    const individualFinalRound = roundLocks.find(
      (roundData) => roundData.round_type === "individual_final"
    );

    if (!teamFinalRound || !individualFinalRound) {
      setErrorMessage(
        "Opret både en holdfinale og en individuel finale under Runder først."
      );
      return;
    }

    if (!teamFinalRound.locked_at || !individualFinalRound.locked_at) {
      setErrorMessage(
        "Både holdfinalen og den individuelle finale skal være låst først."
      );
      return;
    }

    setFinalizingSeason(true);
    setMessage("");
    setErrorMessage("");

    try {
      const [finalData, teamResult] = await Promise.all([
        getFinalStandings({
          season: 2026,
          roundSixNumber: teamFinalRound.round_number,
          roundSevenNumber: individualFinalRound.round_number,
        }),
        getTeamLeaderboard({
          season: 2026,
          roundNumber: teamFinalRound.round_number,
        }),
      ]);

      if (!finalData.finalCompleted || !finalData.champion) {
        throw new Error(
          "Finalestillingen er ikke endelig. Alle 15 spillere skal have gennemført begge finalerunder."
        );
      }

      const teams = teamResult.leaderboard ?? [];
      if (
        teams.length !== 7 ||
        teams.some((team) => team.holesPlayed !== 18)
      ) {
        throw new Error(
          "Holdfinalen er ikke færdig. Alle syv hold skal have 18 gennemførte holdhuller."
        );
      }

      const teamChampion = teams[0];
      const confirmed = window.confirm(
        `Afslut og lås TGT 2026? Individuel mester: ${finalData.champion.playerName}. Holdmester: ${teamChampion.teamName}.`
      );
      if (!confirmed) return;

      const { error } = await supabase.rpc(
        "finalize_tgt_season",
        {
          requested_tournament_id: teamFinalRound.tournament_id,
          requested_individual_champion_id:
            finalData.champion.playerId,
          requested_individual_score:
            finalData.champion.finalScore,
          requested_team_champion_id: teamChampion.teamId,
        }
      );
      if (error) throw error;

      setMessage("TGT 2026 er afsluttet og låst.");
      await loadAdminData();
    } catch (error) {
      console.error("Fejl ved sæsonafslutning:", error);
      setErrorMessage(
        error.message ?? "Sæsonen kunne ikke afsluttes."
      );
    } finally {
      setFinalizingSeason(false);
    }
  }

  return (
    <main className="marker-page tgt-ops-shell">
      <style>{`
        .tgt-ops-shell{min-height:100vh;padding:clamp(18px,4vw,46px) 14px;background:radial-gradient(circle at 12% 4%,rgba(22,132,84,.15),transparent 27%),radial-gradient(circle at 90% 12%,rgba(21,105,73,.20),transparent 30%),linear-gradient(155deg,#031f17 0%,#073727 48%,#0a4935 100%)}
        .tgt-ops-shell>.marker-card{width:min(1180px,100%);margin:0 auto;overflow:hidden;border:1px solid rgba(255,255,255,.42);border-radius:24px;background:#f7faf7;box-shadow:0 28px 80px rgba(0,0,0,.28)}
        .tgt-ops-shell .marker-header{align-items:center;padding:clamp(22px,4vw,36px);color:#ffffff;background:radial-gradient(circle at 92% 0%,rgba(255,255,255,.18),transparent 34%),linear-gradient(135deg,#04251b,#0a4935);border-bottom:1px solid rgba(255,255,255,.35)}
        .tgt-ops-shell .marker-header h1{margin:5px 0 7px;color:#ffffff;font-family:Georgia,serif;font-size:clamp(27px,4vw,42px);line-height:1.05}.tgt-ops-shell .marker-header .eyebrow{color:#dff0e5}.tgt-ops-shell .marker-header .description{color:rgba(255,255,255,.72)}
        .tgt-ops-shell .logout-button{min-height:44px;padding:10px 16px;border:1px solid rgba(255,255,255,.48);border-radius:999px;color:#ffffff;background:rgba(2,27,20,.52);font-weight:900}
        .tgt-ops-shell .login-submit-button{border-color:#168454;color:#ffffff;background:linear-gradient(145deg,#073727,#0a4935);box-shadow:0 8px 20px rgba(3,31,23,.15)}
        .tgt-ops-shell input,.tgt-ops-shell select,.tgt-ops-shell textarea{border-color:rgba(24,72,52,.22)!important;background:#ffffff!important}.tgt-ops-shell input:focus,.tgt-ops-shell select:focus,.tgt-ops-shell textarea:focus{outline:2px solid rgba(22,132,84,.34);border-color:#168454!important}
        @media(max-width:700px){.tgt-ops-shell{padding:8px}.tgt-ops-shell>.marker-card{border-radius:16px}.tgt-ops-shell .marker-header{align-items:flex-start;flex-direction:column;padding:22px 18px}.tgt-ops-shell .marker-header>div:last-child,.tgt-ops-shell .marker-header .logout-button{width:100%}.tgt-ops-shell .marker-header>div:last-child{display:grid!important;grid-template-columns:1fr 1fr}.tgt-ops-shell .flight-information{grid-template-columns:repeat(2,minmax(0,1fr))}.tgt-ops-shell table{min-width:620px}.tgt-ops-shell .table-wrapper{overflow-x:auto;-webkit-overflow-scrolling:touch}.tgt-ops-shell button{min-height:44px}}
      
        /* Release rule: menu-driven navigation and zero gold outside Hall of Fame */
        .tgt-individual-back-button,.tgt-team-back-button,.tgt-live-back-button,.tgt-panel-back-button{display:none!important}
        .tgt-player-shell,.tgt-public-shell,.tgt-menu-page,.tgt-ops-shell{--tgt-accent:#168454;--tgt-accent-light:#eaf5ee;--tgt-ink:#113c2d}
        .tgt-player-shell .eyebrow,.tgt-ops-shell .eyebrow,.tgt-menu-page .eyebrow{color:#168454!important}
        .tgt-player-head .eyebrow,.tgt-player-head h1,.tgt-player-head span,.tgt-marker-live-header,.marker-header h1,.marker-header .eyebrow{color:#fff!important}
        .tgt-player-avatar,.tgt-team-avatar{color:#fff!important;background:linear-gradient(145deg,#27a467,#08794c)!important;border-color:#fff!important;box-shadow:none!important}
        .tgt-player-kpi,.tgt-player-panel,.tgt-player-stat,.tgt-team-profile,.tgt-team-round,.tgt-team-final-kpi,.tgt-profile-directory-card,.tgt-directory-stat,.tgt-final-flow-card,.tgt-marker-kpi,.tgt-course-db-count,.tgt-tee-grid article{border-color:#d7e6dc!important;color:#113c2d!important;background:#fff!important;box-shadow:0 8px 22px rgba(7,63,44,.07)!important}
        .tgt-player-kpi span,.tgt-player-stat small,.tgt-team-round span,.tgt-directory-stat small,.tgt-final-flow-card span,.tgt-marker-kpi span,.tgt-course-db-count span,.tgt-tee-grid article span,.tgt-tee-grid article small{color:#688077!important}
        .tgt-player-kpi strong,.tgt-player-stat strong,.tgt-team-round strong,.tgt-team-final-kpi strong,.tgt-directory-stat strong,.tgt-final-flow-card strong,.tgt-marker-kpi strong,.tgt-course-db-count strong,.tgt-tee-grid article strong{color:#0b6543!important}
        .tgt-player-result strong,.final-score,.tgt-public-live-top-five-row>span:nth-last-child(2),.tgt-marker-top-five-row>span:nth-last-child(2){color:#0b6543!important}
        .tgt-ops-shell>.marker-card,.tgt-player-home{border-color:rgba(255,255,255,.22)!important}
        .tgt-ops-shell .marker-header,.tgt-marker-live-header,.tgt-marker-top-five-card>header,.tgt-marker-live-table thead{border-color:rgba(255,255,255,.16)!important;color:#fff!important;background:linear-gradient(135deg,#075238,#0a6845)!important}
        .tgt-ops-shell .logout-button,.tgt-marker-live-back,.tgt-marker-live-refresh{border-color:rgba(255,255,255,.34)!important;color:#fff!important;background:rgba(255,255,255,.12)!important}
        .tgt-marker-live-toggle button.active,.tgt-course-list button.active{border-color:#168454!important;color:#fff!important;background:#168454!important}
        .tgt-marker-live-table th{color:#fff!important;border-bottom-color:rgba(255,255,255,.18)!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1,.tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1 span{color:#fff!important;background:none!important;-webkit-text-fill-color:#fff!important;filter:none!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-kicker{border-color:rgba(255,255,255,.38)!important;color:#fff!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-primary-action{border-color:#fff!important;color:#fff!important;background:#168454!important}
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.20)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(238,250,242,.72)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(255,255,255,.14)!important}.tgt-fixed-play-disc{border-color:#fff!important;color:#fff!important;background:linear-gradient(145deg,#ef5a61,#c9323a)!important}
`}</style>

      <section className="marker-card">
        <div className="marker-header">
          <div>
            <p className="eyebrow">TGT administration</p>
            <h1>TGT Administration</h1>
            <p className="description">
              Administrér spillere, hold, runder, deltagere, bolde og baner ens på tværs af sæsoner.
            </p>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="logout-button"
          >
            Log ud
          </button>
        </div>

        {loading && (
          <div className="status-box">Henter admindata...</div>
        )}

        {!loading && errorMessage && (
          <div className="error-box">
            <strong>Handlingen kunne ikke gennemføres</strong>
            <span>{errorMessage}</span>
          </div>
        )}

        {!loading && (
          <div className="tgt-admin-polish" style={{ padding: 22 }}>
            <nav
              aria-label="Administrationssæson"
              style={{
                display: "flex",
                gap: 10,
                padding: 8,
                borderRadius: 16,
                background: "#eef3ef",
                marginBottom: 18,
              }}
            >
              {[
                [String(ACTIVE_SEASON), `TGT ${ACTIVE_SEASON}`],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => { setAdminSeasonTab(value); setAdminSection("overview"); }}
                  className={
                    adminSeasonTab === value
                      ? "login-submit-button"
                      : "login-cancel-button"
                  }
                  style={{ flex: 1, marginTop: 0 }}
                >
                  {label}
                </button>
              ))}
            </nav>

            {(adminSeasonTab === "2026" || season2027) && (
              <nav
                aria-label={`TGT ${adminSeasonTab} administration`}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  padding: 10,
                  border: "1px solid #dce5de",
                  borderRadius: 14,
                  background: "#ffffff",
                  marginBottom: 22,
                  position: "sticky",
                  top: 10,
                  zIndex: 5,
                  boxShadow: "0 8px 24px rgba(16, 52, 37, 0.08)",
                }}
              >
                {[
                  ["overview", "Overblik"],
                  ["players", "Spillere"],
                  ["teams", "Hold"],
                  ["rounds", "Runder"],
                  ["participants", "Deltagere"],
                  ["flights", "Bolde"],
                  ["courses", "Banedatabase"],
                  ["season_center", "Sæsoncenter"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setAdminSection(value)}
                    className={
                      adminSection === value
                        ? "login-submit-button"
                        : "login-cancel-button"
                    }
                    style={{ width: "auto", marginTop: 0 }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            )}
            {adminSection === "season_center" && (
              <>
                <section style={{ padding: 20, border: "1px solid rgba(22,132,84,.42)", borderRadius: 16, background: "linear-gradient(135deg, #f7faf7, #ffffff)", marginBottom: 24 }}>
                  <p className="eyebrow">Trin 1 · Grundspil</p>
                  <h2 style={{ marginTop: 0 }}>Manuel halvering</h2>
                  <p className="description">Der halveres først, når du trykker på knappen. De fire bedste runder tæller. Har en spiller eller et hold kun tre runder, tæller den dårligste af de tre som fjerde runde også.</p>
                  <div className="flight-information" style={{ marginTop: 18 }}>
                    <div><span>Spillere</span><strong>{regularSeasonPreview.length}</strong></div>
                    <div><span>Princip</span><strong>4 bedste runder tæller</strong></div>
                    <div><span>Status</span><strong>{regularSeasonArchive.length > 0 ? "Afsluttet" : "Åben"}</strong></div>
                    <div><span>Finalegrundlag</span><strong>{regularSeasonArchive.length > 0 ? `${regularSeasonArchive.length} gemt` : "Ikke gemt"}</strong></div>
                  </div>
                  <div className="table-wrapper" style={{ marginTop: 16 }}>
                    <table>
                      <thead><tr><th>#</th><th>Spiller</th><th className="number-column">4 bedste</th><th className="number-column">Halveret</th><th>Status</th></tr></thead>
                      <tbody>
                        {(regularSeasonArchive.length > 0 ? regularSeasonArchive : regularSeasonPreview).map((player, index) => (
                          <tr key={player.player_id}>
                            <td>{index + 1}</td><td><span className="player-name">{player.player_name}</span></td>
                            <td className="number-column">{formatScore(player.counting_score)}</td>
                            <td className="number-column final-score">{formatScore(player.halved_score)}</td>
                            <td>{regularSeasonArchive.length > 0 ? "Gemt" : "4 bedste runder tæller"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={handleFinalizeIndividualRegularSeason} disabled={finalizingIndividualRegularSeason || regularSeasonPreview.length === 0 || regularSeasonPreview.some((player) => Number(player.counting_rounds) < 3)} className="login-submit-button" style={{ maxWidth: 420, marginTop: 18 }}>
                    {finalizingIndividualRegularSeason ? "Beregner individuel score..." : regularSeasonArchive.length > 0 ? "Genberegn individuel score" : "Halver individuel score"}
                  </button>
                </section>

                <section style={{ padding:20,border:"1px solid rgba(22,132,84,.42)",borderRadius:16,background:"#ffffff",marginBottom:24 }}>
                  <p className="eyebrow">Holdturnering · TGT {adminSeasonTab}</p>
                  <h2 style={{marginTop:0}}>Manuel halvering af holdscore</h2>
                  <p className="description">Holdscoren halveres kun, når du trykker her. De fire bedste holdrunder tæller. Har et hold kun tre runder, tæller holdets dårligste runde også som den fjerde.</p>
                  <div className="flight-information" style={{marginTop:16}}><div><span>Hold klar</span><strong>{regularSeasonTeamPreview.filter((team)=>Number(team.roundsPlayed)>=3).length}</strong></div><div><span>Status</span><strong>{teamRegularSeasonArchive.length>0?"Halveret":"Ikke halveret"}</strong></div></div>
                  <button type="button" onClick={handleFinalizeTeamRegularSeason} disabled={finalizingTeamRegularSeason||regularSeasonTeamPreview.length===0||regularSeasonTeamPreview.every((team)=>Number(team.roundsPlayed)<3)} className="login-submit-button" style={{maxWidth:420,marginTop:18}}>{finalizingTeamRegularSeason?"Beregner holdscore...":teamRegularSeasonArchive.length>0?"Genberegn holdscore":"Halver holdscore"}</button>
                </section>

                {adminSeasonTab === "2027" && (
                  <section style={{ padding: 20, border: "1px solid #d8e4db", borderRadius: 16, background: "#eef7f0", marginBottom: 24 }}>
                    <p className="eyebrow">Sæsoncenter · TGT 2027</p>
                    <h2 style={{ marginTop: 0 }}>Grundspil og finale</h2>
                    <p className="description">Sæsoncenteret følger samme model som 2026. Når alle spillere har fire tællende runder, kan grundspillet afsluttes og det halverede finaleudgangspunkt gemmes ovenfor.</p>
                    <div className="tgt-final-flow-grid">
                      <div className="tgt-final-flow-card"><span>Trin 1</span><strong>Afslut grundspillet</strong></div>
                      <div className="tgt-final-flow-card"><span>Trin 2</span><strong>Opret finalerunder under Runder</strong></div>
                      <div className="tgt-final-flow-card"><span>Trin 3</span><strong>Afslut sæsonen og arkivér mestrene</strong></div>
                    </div>
                  </section>
                )}
                {adminSeasonTab === "2026" && <>
                <section
                  style={{
                    padding: 20,
                    border: "1px solid #d8e4db",
                    borderRadius: 16,
                    background: "linear-gradient(135deg, #eef7f0, #ffffff)",
                    marginBottom: 24,
                  }}
                >
                  <p className="eyebrow">Sæsoncenter · TGT {adminSeasonTab}</p>
                  <h2 style={{ marginTop: 0 }}>Afslut grundspillet og klargør sæsonfinalen</h2>
                  <p className="description">
                    Finalerunder bruger samme sikre flow som alle andre runder:
                    deltagere, bolde, markørlogin, publicering og livescoring.
                  </p>
                  <div className="tgt-final-flow-grid">
                    <div className="tgt-final-flow-card"><span>Holdfinale</span><strong>{roundLocks.find((roundData) => roundData.round_type === "team_final")?.name ?? "Opret under Runder"}</strong></div>
                    <div className="tgt-final-flow-card"><span>Individuel finale</span><strong>{roundLocks.find((roundData) => roundData.round_type === "individual_final")?.name ?? "Opret under Runder"}</strong></div>
                    <div className="tgt-final-flow-card"><span>Arbejdsgang</span><strong>Draft → Ready → Live</strong></div>
                  </div>
                </section>


            <section
              style={{
                padding: 20,
                border: "1px solid #d8e4db",
                borderRadius: 16,
                background: "#ffffff",
                marginBottom: 24,
              }}
            >
              <p className="eyebrow">Skrivebeskyttelse</p>
              <h2 style={{ marginTop: 0 }}>Lås og genåbn runder</h2>
              <p className="description">
                En låst runde kan ikke modtage, ændre eller slette scores og
                tættest-på-pinden-registreringer. Genåbn kun ved rettelser.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(250px, 1fr))",
                  gap: 14,
                  marginTop: 18,
                }}
              >
                {roundLocks.map((roundData) => {
                  const isLocked = Boolean(roundData.locked_at);

                  return (
                    <article
                      key={roundData.id}
                      style={{
                        padding: 18,
                        border: "1px solid #e0e8e2",
                        borderRadius: 14,
                        background: isLocked ? "#eef7f0" : "#fafbf9",
                      }}
                    >
                      <p className="eyebrow">
                        {formatDate(roundData.played_at)}
                      </p>
                      <h3 style={{ margin: "5px 0 8px" }}>
                        Runde {roundData.round_number}
                      </h3>
                      <strong
                        style={{
                          display: "block",
                          color: isLocked ? "#176334" : "#0b6543",
                          marginBottom: 12,
                        }}
                      >
                        {isLocked ? "Låst" : "Åben"}
                      </strong>
                      {isLocked && (
                        <small
                          style={{
                            display: "block",
                            color: "#78827d",
                            marginBottom: 12,
                          }}
                        >
                          Låst {new Date(roundData.locked_at).toLocaleString("da-DK")}
                        </small>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRoundLock(roundData)}
                        disabled={changingRoundId === roundData.id}
                        className={
                          isLocked
                            ? "login-cancel-button"
                            : "login-submit-button"
                        }
                        style={{ marginTop: 0 }}
                      >
                        {changingRoundId === roundData.id
                          ? "Arbejder..."
                          : isLocked
                            ? `Genåbn Runde ${roundData.round_number}`
                            : `Lås Runde ${roundData.round_number}`}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>

            <section
              style={{
                padding: 20,
                border: "1px solid #e0e8e2",
                borderRadius: 16,
                background: "#f8faf8",
              }}
            >
              <p className="eyebrow">Par 3-konkurrencen</p>
              <h2 style={{ marginTop: 0 }}>Tættest på pinden</h2>

              <button
                type="button"
                onClick={handleFinalizeClosestToPin}
                disabled={finalizing || !roundId}
                className="login-submit-button"
                style={{ maxWidth: 360, marginTop: 8 }}
              >
                {finalizing
                  ? "Godkender vindere..."
                  : "Godkend tættest på pinden"}
              </button>

              {approvedWinners.length === 0 ? (
                <div className="status-box" style={{ margin: "16px 0 0" }}>
                  Der er endnu ingen godkendte vindere.
                </div>
              ) : (
                <div className="table-wrapper" style={{ marginTop: 16 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Hul</th>
                        <th>Spiller</th>
                        <th className="number-column">Afstand</th>
                        <th className="number-column">Bonus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedWinners.map((winner) => (
                        <tr key={winner.id}>
                          <td>Hul {winner.hole_number}</td>
                          <td>
                            <span className="player-name">
                              {winner.players?.name ?? "Ukendt spiller"}
                            </span>
                          </td>
                          <td className="number-column">
                            {Number(winner.distance_meters).toLocaleString(
                              "da-DK",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )} meter
                          </td>
                          <td className="number-column final-score">
                            -{winner.bonus_strokes} slag
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section
              style={{
                marginTop: 24,
                padding: 20,
                border: "1px solid #d8e4db",
                borderRadius: 16,
                background: "#ffffff",
              }}
            >
              <p className="eyebrow">12. september 2026</p>
              <h2 style={{ marginTop: 0 }}>Forhåndsvis finalebolde</h2>
              <p className="description">
                Visningen skriver ikke noget til Runde 7. Den beregner kun
                placeringerne og kontrollerer, om alle 15 spillere er klar.
              </p>

              <button
                type="button"
                onClick={handleLoadFinalPreview}
                disabled={loadingPreview}
                className="login-submit-button"
                style={{ maxWidth: 360 }}
              >
                {loadingPreview
                  ? "Beregner finalebolde..."
                  : "Beregn og vis finalebolde"}
              </button>

              {finalPreview && (
                <>
                  <div className="flight-information" style={{ marginTop: 18 }}>
                    <div>
                      <span>Spillere</span>
                      <strong>{finalPreview.standings.length}</strong>
                    </div>
                    <div>
                      <span>Gennemført Runde 6</span>
                      <strong>{finalPreview.completedPlayers} / 15</strong>
                    </div>
                    <div>
                      <span>Validering</span>
                      <strong>
                        {previewValidation?.valid ? "Klar" : "Afventer"}
                      </strong>
                    </div>
                    <div>
                      <span>Kan oprettes</span>
                      <strong>{finalPreview.canGenerate ? "Ja" : "Nej"}</strong>
                    </div>
                  </div>

                  {!previewValidation?.valid && (
                    <div className="error-box" style={{ margin: "18px 0 0" }}>
                      <strong>Finaleboldene kan ikke godkendes endnu</strong>
                      {(previewValidation?.errors ?? []).map((error) => (
                        <span key={error}>{error}</span>
                      ))}
                    </div>
                  )}

                  <h2 style={{ marginTop: 28 }}>Foreløbig finalestilling</h2>
                  <div className="table-wrapper" style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th className="position-column">Placering</th>
                          <th>Spiller</th>
                          <th className="number-column">Udgangspunkt</th>
                          <th className="number-column">Runde 6</th>
                          <th className="number-column">Samlet</th>
                          <th className="number-column">Thru</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finalPreview.standings.map((player) => (
                          <tr key={player.playerId}>
                            <td className="position-column">
                              <span
                                className={`position-badge position-${player.position}`}
                              >
                                {player.position}
                              </span>
                            </td>
                            <td>
                              <span className="player-name">
                                {player.playerName}
                              </span>
                            </td>
                            <td className="number-column">
                              {formatScore(player.startingScore)}
                            </td>
                            <td className="number-column">
                              {player.holesPlayed === 0
                                ? "Ikke startet"
                                : formatScore(player.officialRoundScore)}
                            </td>
                            <td className="number-column final-score">
                              {player.finalScore === null
                                ? "Afventer"
                                : formatScore(player.finalScore)}
                            </td>
                            <td className="number-column">
                              {player.holesPlayed}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h2 style={{ marginTop: 30 }}>Finalebolde</h2>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(250px, 1fr))",
                      gap: 14,
                      marginTop: 14,
                    }}
                  >
                    {finalPreview.flights.map((flight) => (
                      <article
                        key={flight.flightNumber}
                        style={{
                          padding: 18,
                          border: "1px solid #e0e8e2",
                          borderRadius: 16,
                          background:
                            flight.flightNumber === 4
                              ? "#eef7f0"
                              : "#fafbf9",
                        }}
                      >
                        <p className="eyebrow">
                          Placering {flight.firstPosition} til {flight.lastPosition}
                        </p>
                        <h3 style={{ margin: "5px 0 12px" }}>
                          {flight.flightName}
                        </h3>

                        {flight.players.map((player) => (
                          <div
                            key={player.playerId}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              padding: "9px 0",
                              borderTop: "1px solid #e7ece8",
                            }}
                          >
                            <span>
                              {player.playingOrder}. {player.playerName}
                            </span>
                            <strong>
                              {player.finalScore === null
                                ? "Afventer"
                                : formatScore(player.finalScore)}
                            </strong>
                          </div>
                        ))}
                      </article>
                    ))}
                  </div>

                  <div className="status-box" style={{ margin: "22px 0 0" }}>
                    {flightsCreated
                      ? "Finaleboldene er oprettet i Runde 7."
                      : "Dette er kun en forhåndsvisning. Ingen spillere er endnu oprettet i finaleboldene på Runde 7."}
                  </div>

                  <button
                    type="button"
                    onClick={handleCreateFinalFlights}
                    disabled={
                      creatingFlights ||
                      !previewValidation?.valid ||
                      !finalPreview.canGenerate
                    }
                    className="login-submit-button"
                    style={{ maxWidth: 420, marginTop: 16 }}
                  >
                    {creatingFlights
                      ? "Opretter finalebolde..."
                      : flightsCreated
                        ? "Finalebolde er oprettet"
                        : "Godkend og opret finalebolde"}
                  </button>
                </>
              )}
            </section>

                </>}
              </>
            )}

            {(adminSeasonTab === "2026" || season2027) && (
              <>
                {adminSection === "overview" && (
            <section
              style={{
                marginTop: 24,
                padding: 20,
                border: "1px solid #d8e4db",
                borderRadius: 16,
                background: season2027 ? "#eef7f0" : "#ffffff",
              }}
            >
              <p className="eyebrow">Ny sæson</p>
              <h2 style={{ marginTop: 0 }}>
                {season2027 ? `TGT ${ACTIVE_SEASON} er klar` : `TGT ${ACTIVE_SEASON} mangler`}
              </h2>

              {season2027 ? (
                <div className="flight-information" style={{ marginTop: 18 }}>
                  <div>
                    <span>Status</span>
                    <strong>{season2027.status}</strong>
                  </div>
                  <div>
                    <span>Offentlig</span>
                    <strong>{season2027.is_public ? "Ja" : "Nej"}</strong>
                  </div>
                  <div>
                    <span>Aktive spillere</span>
                    <strong>{season2027PlayerCount}</strong>
                  </div>
                  <div>
                    <span>Opsætning</span>
                    <strong>{season2027.is_public ? "Klar" : "Kladde"}</strong>
                  </div>
                </div>
              ) : (
                <>
                  <p className="description">
                    Opretter næste TGT-sæson og kopierer automatisk aktive spillere, aktive hold og rundeopsætningen. Rundedatoerne flyttes ét år. Bolde, deltagere, scores og historiske resultater kopieres ikke.
                  </p>

                  <button
                    type="button"
                    onClick={handleCreateSeason2027}
                    disabled={creatingSeason2027}
                    className="login-submit-button"
                    style={{ maxWidth: 420 }}
                  >
                    {creatingSeason2027
                      ? `Opretter TGT ${ACTIVE_SEASON + 1}...`
                      : `Opret TGT ${ACTIVE_SEASON + 1}`}
                  </button>
                </>
              )}
            </section>

                )}

                {adminSection === "players" && (
                  <SeasonPlayersAdmin season={Number(adminSeasonTab)} />
                )}
                {adminSection === "teams" && (
                  <SeasonTeamsAdmin season={Number(adminSeasonTab)} />
                )}
                {adminSection === "rounds" && (
                  <SeasonRoundsAdmin season={Number(adminSeasonTab)} />
                )}
                {adminSection === "participants" && (
                  <RoundParticipantsAdmin season={Number(adminSeasonTab)} />
                )}
                {adminSection === "flights" && (
                  <FlightAdmin season={Number(adminSeasonTab)} />
                )}
                {adminSection === "courses" && (
                  <CourseDatabaseAdmin />
                )}
              </>
            )}

            {adminSeasonTab === "2026" && (
              <>

            <section
              style={{
                marginTop: 24,
                padding: 20,
                border: "1px solid #d8e4db",
                borderRadius: 16,
                background: seasonArchive ? "#eef7f0" : "#ffffff",
              }}
            >
              <p className="eyebrow">Sæsonafslutning</p>
              <h2 style={{ marginTop: 0 }}>
                {seasonArchive
                  ? "TGT 2026 er afsluttet"
                  : "Afslut og lås TGT 2026"}
              </h2>

              {seasonArchive ? (
                <div className="flight-information" style={{ marginTop: 18 }}>
                  <div>
                    <span>Individuel mester</span>
                    <strong>{seasonArchive.individual_champion_name}</strong>
                  </div>
                  <div>
                    <span>Slutscore</span>
                    <strong>{formatScore(seasonArchive.individual_score)}</strong>
                  </div>
                  <div>
                    <span>Holdmester</span>
                    <strong>{seasonArchive.team_champion_name}</strong>
                  </div>
                  <div>
                    <span>Afsluttet</span>
                    <strong>
                      {new Date(
                        seasonArchive.finalized_at
                      ).toLocaleString("da-DK")}
                    </strong>
                  </div>
                </div>
              ) : (
                <>
                  <p className="description">
                    Begge runder skal være låst. Systemet kontrollerer
                    derefter alle 15 spillere og alle syv hold, gemmer
                    mestrene permanent og låser sæsonen.
                  </p>
                  <button
                    type="button"
                    onClick={handleFinalizeSeason}
                    disabled={
                      finalizingSeason ||
                      roundLocks.length !== 2 ||
                      roundLocks.some(
                        (roundData) => !roundData.locked_at
                      )
                    }
                    className="login-submit-button"
                    style={{ maxWidth: 420 }}
                  >
                    {finalizingSeason
                      ? "Afslutter TGT 2026..."
                      : "Afslut og lås TGT 2026"}
                  </button>
                  {roundLocks.some(
                    (roundData) => !roundData.locked_at
                  ) && (
                    <div className="status-box" style={{ margin: "16px 0 0" }}>
                      Holdfinalen og den individuelle finale skal begge være oprettet og låst først.
                    </div>
                  )}
                </>
              )}
            </section>

              </>
            )}

            {message && (
              <div
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 10,
                  background: "#e7f6eb",
                  color: "#176334",
                  fontWeight: 700,
                }}
              >
                {message}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function MarkerDashboard({
  session,
  onLogout,
  playerId = null,
  onBackToPlayer = null,
}) {
  const [assignment, setAssignment] = useState(null);
  const [availableAssignments, setAvailableAssignments] = useState([]);
  const [selectedRoundNumber, setSelectedRoundNumber] = useState(null);
  const [players, setPlayers] = useState([]);
  const [holes, setHoles] = useState([]);
  const [existingScores, setExistingScores] =
    useState([]);
  const [damebajere, setDamebajere] = useState([]);
  const [savingDamebajerId, setSavingDamebajerId] = useState(null);
  const [markerTee, setMarkerTee] = useState(null);

  const [selectedHole, setSelectedHole] = useState(1);
  const [draftScores, setDraftScores] = useState({});

  const [loading, setLoading] = useState(true);
  const [assignmentError, setAssignmentError] =
    useState("");

  const [savingScores, setSavingScores] =
    useState(false);

  const [saveMessage, setSaveMessage] =
    useState("");

  const [saveError, setSaveError] =
    useState("");

  const [closestPlayerId, setClosestPlayerId] =
    useState("");
  const [closestDistance, setClosestDistance] =
    useState("");
  const [closestEntry, setClosestEntry] =
    useState(null);
  const [closestLoading, setClosestLoading] =
    useState(false);
  const [closestMessage, setClosestMessage] =
    useState("");
  const [closestError, setClosestError] =
    useState("");
  const [markerLiveOpen, setMarkerLiveOpen] = useState(false);
  const [markerLiveView, setMarkerLiveView] = useState("individual");
  const [markerLiveData, setMarkerLiveData] = useState(null);
  const [markerTeamData, setMarkerTeamData] = useState(null);
  const [markerLiveLoading, setMarkerLiveLoading] = useState(false);
  const [markerLiveError, setMarkerLiveError] = useState("");
  const [markerScoreEventVersion, setMarkerScoreEventVersion] = useState(0);
  const [markerIndividualTopFive, setMarkerIndividualTopFive] = useState([]);
  const [markerTeamTopFive, setMarkerTeamTopFive] = useState([]);
  const markerLiveRequestRef = useRef(0);
  async function loadMarkerLiveScore() {
    const requestId = ++markerLiveRequestRef.current;
    if (!assignment?.round_id || !assignment?.rounds?.round_number) return;
    setMarkerLiveLoading(true);
    setMarkerLiveError("");
    try {
      const season = Number(assignment.rounds?.tournaments?.season ?? ACTIVE_SEASON);
      const mode = assignment.rounds?.live_leaderboard_mode ?? "none";
      let effectiveMarkerTee = markerTee;
      if (!effectiveMarkerTee && assignment.rounds?.tee_id) {
        const { data: teeData, error: teeError } = await supabase
          .from("course_tees")
          .select("id, tee_name, course_rating, slope_rating")
          .eq("id", assignment.rounds.tee_id)
          .maybeSingle();
        if (teeError) throw teeError;
        effectiveMarkerTee = teeData ?? null;
        if (effectiveMarkerTee) setMarkerTee(effectiveMarkerTee);
      }
      const { data: seasonRounds, error: seasonRoundsError } = await supabase
        .from("rounds")
        .select("id, round_number, round_type")
        .eq("tournament_id", assignment.rounds.tournament_id)
        .order("round_number", { ascending: true });
      if (seasonRoundsError) throw seasonRoundsError;
      const teamFinalRound = (seasonRounds ?? []).find((round) => round.round_type === "team_final");
      const individualFinalRound = (seasonRounds ?? []).find((round) => round.round_type === "individual_final");
      const [individualData, teamData, seasonStandingsResult, teamHistoryResult] = await Promise.all([
        getLiveRoundLeaderboard({ season, roundId: assignment.round_id }),
        getTeamLeaderboard({ season, roundNumber: assignment.rounds.round_number }),
        supabase
          .from("season_individual_standings")
          .select("player_id, player_name, counting_score")
          .eq("season", season),
        supabase
          .from("team_round_results")
          .select(`team_id, round_number, score, teams (name), tournaments!inner (season)`)
          .eq("tournaments.season", season)
          .not("score", "is", null),
      ]);
      if (seasonStandingsResult.error) throw seasonStandingsResult.error;
      if (teamHistoryResult.error) throw teamHistoryResult.error;

      let individualTopFive = sortStandings(seasonStandingsResult.data ?? []).slice(0, 5).map((player) => ({
        id: player.player_id,
        name: player.player_name,
        score: player.counting_score,
        holesPlayed: 0,
      }));
      if (["individual", "both"].includes(mode) && teamFinalRound && individualFinalRound) {
        const finalData = await getFinalStandings({
          season,
          roundSixNumber: teamFinalRound.round_number,
          roundSevenNumber: individualFinalRound.round_number,
        });
        individualTopFive = [...(finalData?.standings ?? [])]
          .map((player) => ({
            id: player.playerId,
            name: player.playerName,
            score: player.finalScore ?? player.startingScore,
            holesPlayed:
              assignment.rounds.round_type === "individual_final"
                ? player.roundSevenHoles
                : player.roundSixHoles,
          }))
          .sort((a, b) => Number(a.score ?? Infinity) - Number(b.score ?? Infinity) || a.name.localeCompare(b.name, "da"))
          .slice(0, 5);
      }

      const historyByTeam = {};
      (teamHistoryResult.data ?? []).forEach((result) => {
        historyByTeam[result.team_id] ??= {
          id: result.team_id,
          name: result.teams?.name ?? "Ukendt hold",
          rounds: [],
        };
        // Bevar det officielle hold-udgangspunkt præcis som i det offentlige
        // leaderboard. Den aktuelle live nettoscore lægges til separat nedenfor.
        historyByTeam[result.team_id].rounds.push(Number(result.score));
      });
      const normalizedIndividual = normalizeIndividualLiveLeaderboard(
        individualData?.leaderboard ?? [],
        {
          ...(individualData?.round ?? {}),
          tee: effectiveMarkerTee ?? individualData?.round?.tee ?? null,
          holes: individualData?.holes ?? holes,
        }
      );
      // Samlet individuel live-stilling på markørsiden bruger rundens
      // normaliserede nettoscore. Brug kun normalizedIndividual, som er
      // defineret lige ovenfor.
      if (["individual", "both"].includes(mode) && !(teamFinalRound && individualFinalRound)) {
        const liveIndividualById = new Map(
          normalizedIndividual.map((player) => [
            String(player.playerId ?? player.player_id ?? player.id),
            player,
          ])
        );
        individualTopFive = (seasonStandingsResult.data ?? [])
          .map((player) => {
            const livePlayer = liveIndividualById.get(String(player.player_id));
            const holesPlayed = Number(livePlayer?.holesPlayed ?? 0);
            const liveNetScore = holesPlayed > 0
              ? Number(livePlayer?.scoreToPar ?? 0)
              : 0;
            return {
              id: player.player_id,
              name: player.player_name,
              score: Number(player.counting_score ?? 0) + liveNetScore,
              holesPlayed,
            };
          })
          .sort((a, b) =>
            Number(a.score ?? Infinity) - Number(b.score ?? Infinity) ||
            Number(b.holesPlayed ?? 0) - Number(a.holesPlayed ?? 0) ||
            a.name.localeCompare(b.name, "da")
          )
          .slice(0, 5);
      }
      const normalizedTeams = normalizeTeamLiveLeaderboard(
        teamData?.leaderboard ?? [],
        normalizedIndividual
      );
      const liveTeamById = new Map(
        normalizedTeams.map((team) => [String(team.teamId ?? team.id), team])
      );
      const teamTopFive = Object.values(historyByTeam)
        .map((team) => {
          const bestFour = [...team.rounds].sort((a, b) => a - b).slice(0, 4);
          const startingScore = Math.trunc(bestFour.reduce((total, score) => total + score, 0) / 2);
          const liveTeam = liveTeamById.get(String(team.id));
          const liveScore = getTeamScoreToPar(liveTeam);
          const holesPlayed = liveTeam?.holesPlayed ?? liveTeam?.thru ?? 0;
          return {
            ...team,
            score: startingScore + (holesPlayed > 0 && liveScore !== null ? Number(liveScore) : 0),
            holesPlayed,
          };
        })
        .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "da"))
        .slice(0, 5);
      // Kun den nyeste hentning må opdatere markørvisningen. Det fjerner
      // blinket, hvor en ældre realtime-respons kortvarigt overskrev scoren.
      if (requestId !== markerLiveRequestRef.current) return;
      setMarkerLiveData(individualData);
      setMarkerTeamData(teamData);
      setMarkerIndividualTopFive(individualTopFive);
      setMarkerTeamTopFive(teamTopFive);
    } catch (error) {
      if (requestId !== markerLiveRequestRef.current) return;
      console.error("Markørens livescore kunne ikke hentes:", error);
      setMarkerLiveError(error.message ?? "Livescoren kunne ikke hentes.");
    } finally {
      if (requestId === markerLiveRequestRef.current) {
        setMarkerLiveLoading(false);
      }
    }
  }
  async function loadScores(
    roundId,
    loadedPlayers
  ) {
    const playerIds = loadedPlayers.map(
      (player) => player.id
    );

    const scoreRows = await getRoundScores(
      roundId,
      playerIds
    );

    setExistingScores(scoreRows);

    const scoreMap = {};

    scoreRows.forEach((score) => {
      scoreMap[
        `${score.player_id}-${score.hole_number}`
      ] = score.strokes;
    });

    setDraftScores(scoreMap);
  }

  async function loadDamebajere(roundId) {
    const { data, error } = await supabase
      .from("damebajere_public")
      .select("id, round_id, flight_id, player_id, hole_number, created_at")
      .eq("round_id", roundId);
    if (error) throw error;
    setDamebajere(data ?? []);
  }

  async function handleToggleDamebajer(player) {
    if (!assignment?.round_id) return;
    const isRegistered = damebajere.some((entry) =>
      entry.player_id === player.id && Number(entry.hole_number) === Number(selectedHole)
    );
    if (!window.confirm(isRegistered ? `Fjern damebajeren for ${player.name} på hul ${selectedHole}?` : `Registrér damebajer til ${player.name} på hul ${selectedHole}?`)) return;
    setSavingDamebajerId(player.id);
    setSaveError("");
    try {
      const { data, error } = await supabase.rpc("toggle_damebajer", {
        requested_round_id: assignment.round_id,
        requested_player_id: player.id,
        requested_hole_number: selectedHole,
      });
      if (error) throw error;
      await loadDamebajere(assignment.round_id);
      setSaveMessage(data?.registered ? `Damebajer registreret til ${player.name} på hul ${selectedHole}.` : `Damebajeren er fjernet for ${player.name} på hul ${selectedHole}.`);
    } catch (error) {
      setSaveError(error.message ?? "Damebajeren kunne ikke gemmes.");
    } finally {
      setSavingDamebajerId(null);
    }
  }

  useEffect(() => {
    async function loadMarkerFlight() {
      setLoading(true);
      setAssignmentError("");

      let markerRows;
      let markerError;
      if (playerId) {
        const response = await supabase
          .from("flight_players")
          .select(`
            flight_id,
            flights (
              id,
              name,
              flight_number,
              tee_time,
              status,
              round_id,
              rounds (
                id,
                tournament_id,
                tournaments ( season ),
                round_number,
                name,
                played_at,
                course_id,
                tee_id,
                tee_name,
                live_leaderboard_mode,
                locked_at,
                locked_by
              )
            )
          `)
          .eq("player_id", playerId);
        markerRows = response.data;
        markerError = response.error;
      } else {
        const response = await supabase
          .from("flight_markers")
          .select(`
            flight_id,
            active,
            flights (
              id,
              name,
              flight_number,
              tee_time,
              status,
              round_id,
              rounds (
                id,
                tournament_id,
                tournaments ( season ),
                round_number,
                name,
                played_at,
                course_id,
                tee_id,
                tee_name,
                live_leaderboard_mode,
                locked_at,
                locked_by
              )
            )
          `)
          .eq("user_id", session.user.id)
          .eq("active", true);
        markerRows = response.data;
        markerError = response.error;
      }

      if (markerError) {
        console.error(
          "Fejl ved hentning af markørbold:",
          markerError
        );

        setAssignmentError(markerError.message);
        setLoading(false);
        return;
      }

      const assignments = (markerRows ?? [])
        .map((row) => row.flights)
        .filter((flight) => flight?.rounds)
        .sort(
          (a, b) =>
            a.rounds.round_number -
            b.rounds.round_number
        );

      setAvailableAssignments(assignments);

      if (assignments.length === 0) {
        setAssignmentError(
          playerId
            ? "Du er ikke placeret i en bold på en tilgængelig runde."
            : "Dette login er ikke knyttet til en aktiv bold."
        );
        setLoading(false);
        return;
      }

      if (selectedRoundNumber === null) {
        if (assignments.length === 1) {
          setSelectedRoundNumber(
            assignments[0].rounds.round_number
          );
        }
        setLoading(false);
        return;
      }

      const flight = assignments.find(
        (item) =>
          item.rounds.round_number ===
          selectedRoundNumber
      );

      if (!flight) {
        setAssignmentError(
          "Den valgte runde er ikke knyttet til dette login."
        );
        setLoading(false);
        return;
      }

      setAssignment(flight);
      setMarkerTee(null);
      if (flight.rounds?.tee_id) {
        const { data: teeData, error: teeError } = await supabase
          .from("course_tees")
          .select("id, tee_name, course_rating, slope_rating")
          .eq("id", flight.rounds.tee_id)
          .maybeSingle();
        if (teeError) throw teeError;
        setMarkerTee(teeData ?? null);
      }
      setSelectedHole(1);
      setSaveMessage("");
      setSaveError("");

      const {
        data: flightPlayerRows,
        error: playerError,
      } = await supabase
        .from("flight_players")
        .select(`
          playing_order,
          player_id,
          players (
            id,
            name,
            handicap_index
          )
        `)
        .eq("flight_id", flight.id)
        .order("playing_order", {
          ascending: true,
        });

      if (playerError) {
        console.error(
          "Fejl ved hentning af boldens spillere:",
          playerError
        );

        setAssignmentError(playerError.message);
        setLoading(false);
        return;
      }

      const loadedPlayers = (
        flightPlayerRows ?? []
      )
        .map((row) => ({
          playingOrder: row.playing_order,
          id: row.players?.id,
          name: row.players?.name,
          handicap:
            row.players?.handicap_index,
        }))
        .filter((player) => player.id);

      setPlayers(loadedPlayers);

      const courseId =
        flight.rounds?.course_id;

      if (!courseId) {
        setAssignmentError(
          "Runden har ikke en golfbane tilknyttet."
        );

        setLoading(false);
        return;
      }

      const {
        data: holeRows,
        error: holeError,
      } = await supabase
        .from("course_holes")
        .select(`
          id,
          hole_number,
          par,
          stroke_index
        `)
        .eq("course_id", courseId)
        .order("hole_number", {
          ascending: true,
        });

      if (holeError) {
        console.error(
          "Fejl ved hentning af scorekort:",
          holeError
        );

        setAssignmentError(holeError.message);
        setLoading(false);
        return;
      }

      setHoles(holeRows ?? []);

      try {
        await loadScores(
          flight.round_id,
          loadedPlayers
        );
        await loadDamebajere(flight.round_id);
      } catch (scoreError) {
        console.error(
          "Fejl ved hentning af scores:",
          scoreError
        );

        setAssignmentError(scoreError.message);
        setLoading(false);
        return;
      }

      setLoading(false);
    }

    loadMarkerFlight();
  }, [session.user.id, selectedRoundNumber, playerId]);

  function handleSelectRound(roundNumber) {
    setAssignment(null);
    setPlayers([]);
    setHoles([]);
    setExistingScores([]);
    setDraftScores({});
    setClosestEntry(null);
    setClosestPlayerId("");
    setClosestDistance("");
    setAssignmentError("");
    setSelectedRoundNumber(roundNumber);
  }

  function handleScoreChange(
    playerId,
    value
  ) {
    setSaveMessage("");
    setSaveError("");

    setDraftScores((currentScores) => ({
      ...currentScores,

      [`${playerId}-${selectedHole}`]:
        value === "" ? "" : Number(value),
    }));
  }

  async function handleSaveHole() {
    if (!assignment) return;

    setSavingScores(true);
    setSaveMessage("");
    setSaveError("");

    const scoreChanges = players.map((player) => {
      const value = draftScores[`${player.id}-${selectedHole}`];
      const isEmpty = value === "" || value === null || value === undefined;
      return {
        playerId: player.id,
        strokes: isEmpty ? null : Number(value),
        isEmpty,
      };
    });

    const scoresToDelete = scoreChanges.filter((score) => score.isEmpty);
    const scoresToSave = scoreChanges
      .filter((score) => !score.isEmpty)
      .map(({ playerId, strokes }) => ({ playerId, strokes }));

    try {
      if (scoresToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from("scores")
          .delete()
          .eq("round_id", assignment.round_id)
          .eq("hole_number", selectedHole)
          .in("player_id", scoresToDelete.map((score) => score.playerId));
        if (deleteError) throw deleteError;
      }

      if (scoresToSave.length > 0) {
        await saveHoleScores({
          roundId: assignment.round_id,
          holeNumber: selectedHole,
          scores: scoresToSave,
        });
      }

      setSaveMessage(
        scoresToDelete.length > 0
          ? `Hul ${selectedHole} er opdateret. Tomme scorefelter er slettet.`
          : `Hul ${selectedHole} er gemt for hele bolden.`
      );
      await loadScores(assignment.round_id, players);
      if (assignment.rounds?.live_leaderboard_mode !== "none") {
        await loadMarkerLiveScore();
        setMarkerScoreEventVersion((current) => current + 1);
      }
      if (
        scoresToDelete.length === 0 &&
        scoresToSave.length === players.length &&
        selectedHole < 18 &&
        holes.length >= selectedHole + 1
      ) {
        setSelectedHole((currentHole) => currentHole + 1);
      }
    } catch (error) {
      console.error("Fejl ved gemning eller sletning af scores:", error);
      setSaveError(error.message ?? "Scorerne kunne ikke gemmes eller slettes.");
    } finally {
      setSavingScores(false);
    }
  }

  const selectedHoleData = holes.find(
    (hole) =>
      hole.hole_number === selectedHole
  );

  const isClosestToPinHole =
    selectedHoleData?.par === 3;

  useEffect(() => {
    async function loadClosestEntry() {
      setClosestMessage("");
      setClosestError("");

      if (
        !assignment?.round_id ||
        !assignment?.id ||
        !isClosestToPinHole
      ) {
        setClosestEntry(null);
        setClosestPlayerId("");
        setClosestDistance("");
        return;
      }

      setClosestLoading(true);

      try {
        const entry = await getFlightClosestEntry({
          roundId: assignment.round_id,
          flightId: assignment.id,
          holeNumber: selectedHole,
        });

        setClosestEntry(entry);
        setClosestPlayerId(entry?.player_id ?? "");
        setClosestDistance(
          entry?.distance_meters ?? ""
        );
      } catch (error) {
        console.error(
          "Fejl ved hentning af tættest på pinden:",
          error
        );
        setClosestError(
          error.message ??
            "Registreringen kunne ikke hentes."
        );
      } finally {
        setClosestLoading(false);
      }
    }

    loadClosestEntry();
  }, [
    assignment?.round_id,
    assignment?.id,
    selectedHole,
    isClosestToPinHole,
  ]);

  async function handleSaveClosest() {
    if (!assignment || !isClosestToPinHole) {
      return;
    }

    setClosestLoading(true);
    setClosestMessage("");
    setClosestError("");

    try {
      const entry = await saveClosestToPinEntry({
        roundId: assignment.round_id,
        flightId: assignment.id,
        holeNumber: selectedHole,
        playerId: closestPlayerId,
        distanceMeters: closestDistance,
      });

      setClosestEntry(entry);
      setClosestMessage(
        `Kandidat på hul ${selectedHole} er gemt.`
      );
    } catch (error) {
      console.error(
        "Fejl ved gemning af tættest på pinden:",
        error
      );
      setClosestError(
        error.message ??
          "Registreringen kunne ikke gemmes."
      );
    } finally {
      setClosestLoading(false);
    }
  }

  async function handleDeleteClosest() {
    if (!assignment || !closestEntry) {
      return;
    }

    setClosestLoading(true);
    setClosestMessage("");
    setClosestError("");

    try {
      await deleteClosestToPinEntry({
        roundId: assignment.round_id,
        flightId: assignment.id,
        holeNumber: selectedHole,
      });

      setClosestEntry(null);
      setClosestPlayerId("");
      setClosestDistance("");
      setClosestMessage(
        `Kandidaten på hul ${selectedHole} er slettet.`
      );
    } catch (error) {
      console.error(
        "Fejl ved sletning af tættest på pinden:",
        error
      );
      setClosestError(
        error.message ??
          "Registreringen kunne ikke slettes."
      );
    } finally {
      setClosestLoading(false);
    }
  }

  useEffect(() => {
    if (!assignment?.round_id || assignment.rounds?.live_leaderboard_mode === "none") return undefined;
    loadMarkerLiveScore();
    const channel = supabase
      .channel(`tgt-marker-live-${assignment.round_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores", filter: `round_id=eq.${assignment.round_id}` },
        async (payload) => {
          await loadMarkerLiveScore();
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            setMarkerScoreEventVersion((current) => current + 1);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [assignment?.round_id, assignment?.rounds?.round_number, assignment?.rounds?.live_leaderboard_mode]);

  const markerIndividualLeaderboard = normalizeIndividualLiveLeaderboard(
    markerLiveData?.leaderboard ?? [],
    {
      ...(markerLiveData?.round ?? {}),
      tee: markerTee ?? markerLiveData?.round?.tee ?? null,
      holes: markerLiveData?.holes ?? holes,
    }
  ).sort((a, b) => {
    const scoreDifference =
      Number(a?.scoreToPar ?? Infinity) - Number(b?.scoreToPar ?? Infinity);
    if (scoreDifference !== 0) return scoreDifference;
    const holesDifference = Number(b?.holesPlayed ?? 0) - Number(a?.holesPlayed ?? 0);
    if (holesDifference !== 0) return holesDifference;
    return String(a?.playerName ?? "").localeCompare(
      String(b?.playerName ?? ""),
      "da"
    );
  });
  const markerTeamLeaderboard = normalizeTeamLiveLeaderboard(
    markerTeamData?.leaderboard ?? [],
    markerIndividualLeaderboard
  ).sort((a, b) => {
    const scoreDifference =
      Number(getTeamScoreToPar(a) ?? Infinity) -
      Number(getTeamScoreToPar(b) ?? Infinity);
    if (scoreDifference !== 0) return scoreDifference;
    const holesDifference =
      Number(b?.holesPlayed ?? b?.thru ?? 0) -
      Number(a?.holesPlayed ?? a?.thru ?? 0);
    if (holesDifference !== 0) return holesDifference;
    return String(a?.teamName ?? a?.name ?? "").localeCompare(
      String(b?.teamName ?? b?.name ?? ""),
      "da"
    );
  });
  const markerIndividualMovements = usePositionChanges(markerIndividualTopFive, (entry) => entry.id, markerScoreEventVersion);
  const markerTeamMovements = usePositionChanges(markerTeamTopFive, (entry) => entry.id, markerScoreEventVersion);
  function MarkerTopFiveCard({ title, entries, movements }) {
    return (
      <section className="tgt-marker-top-five-card">
        <header><span className="live-dot" /><strong>{title}</strong><small>TOP 5</small></header>
        <div>
          {entries.map((entry, index) => (
            <div className="tgt-marker-top-five-row" key={entry.id ?? `${entry.name}-${index}`}>
              <span className={`position-badge position-${index + 1}`}>{index + 1}</span>
              <strong>{entry.name}</strong>
              <span className="tgt-score-with-movement">
                <span>{formatScore(entry.score)}</span>
                <PositionMovement value={movements[String(entry.id)] ?? 0} />
              </span>
              <small>{entry.holesPlayed ?? 0}/18</small>
            </div>
          ))}
          {entries.length === 0 && <p>Afventer live scores</p>}
        </div>
      </section>
    );
  }
  const completedHoles = holes.filter(
    (hole) =>
      players.length > 0 &&
      players.every((player) => {
        const savedScore =
          existingScores.find(
            (score) =>
              score.player_id === player.id &&
              score.hole_number ===
                hole.hole_number
          );

        return Boolean(savedScore);
      })
  ).length;

  return (
    <main className="marker-page tgt-ops-shell">
      <style>{`
        .tgt-marker-dashboard-card{overflow:visible!important}.tgt-marker-top-five-wrap{position:relative;top:auto;z-index:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;padding:10px 12px;background:rgba(243,239,230,.94);backdrop-filter:blur(12px);border-bottom:1px solid rgba(25,65,48,.14);box-shadow:0 12px 28px rgba(18,48,36,.12)}.tgt-marker-top-five-card{overflow:hidden;border:1px solid rgba(255,255,255,.46);border-radius:16px;background:#ffffff;box-shadow:0 8px 22px rgba(3,31,23,.10)}.tgt-marker-top-five-card>header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:10px 12px;color:#ffffff;background:linear-gradient(135deg,#04251b,#0a4935)}.tgt-marker-top-five-card>header strong{font-size:12px;letter-spacing:.08em}.tgt-marker-top-five-card>header small{color:#dff0e5;font-size:9px;font-weight:900}.tgt-marker-top-five-card>div{padding:5px 9px}.tgt-marker-top-five-row{display:grid;grid-template-columns:32px minmax(0,1fr) 68px 42px;align-items:center;gap:8px;min-height:38px;border-bottom:1px solid #e7ece8}.tgt-marker-top-five-row:last-child{border-bottom:0}.tgt-marker-top-five-row .position-badge{width:25px;height:25px;min-width:25px;font-size:11px}.tgt-marker-top-five-row>strong{overflow:hidden;color:#173d2e;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.tgt-marker-top-five-row>span:nth-last-child(2){color:#0b6543;font-weight:900;text-align:right}.tgt-marker-top-five-row>small{color:#78827d;font-size:10px;font-weight:800;text-align:right}.tgt-marker-top-five-card p{margin:8px;color:#78827d;text-align:center}@media(max-width:600px){.tgt-marker-dashboard-card{overflow:visible!important}.tgt-marker-top-five-wrap{grid-template-columns:1fr;padding:7px;position:relative;top:auto;transform:none;will-change:auto;touch-action:pan-y;max-height:none;overflow:visible}.tgt-marker-top-five-card>header{padding:8px 10px}.tgt-marker-top-five-card>div{padding:3px 8px}.tgt-marker-top-five-row{min-height:34px}.tgt-marker-top-five-row>strong{font-size:12px}}
        .tgt-marker-live-panel{position:fixed;inset:0;z-index:1000;height:100dvh;display:flex;flex-direction:column;overflow:hidden;padding:0;background:#eef5f0}.tgt-marker-live-scroll{flex:1;min-height:0;overflow-x:hidden;overflow-y:scroll;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;touch-action:pan-y;padding:0 0 calc(48px + env(safe-area-inset-bottom))}.tgt-marker-live-header{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;min-height:68px;padding:10px 18px;color:#ffffff;background:linear-gradient(135deg,#04251b,#0a4935);border-bottom:1px solid rgba(255,255,255,.35)}.tgt-marker-live-header strong{text-align:center;font-size:20px}.tgt-marker-live-back,.tgt-marker-live-refresh{min-height:42px;padding:0 14px;border:1px solid rgba(255,255,255,.45);border-radius:999px;color:#ffffff;background:rgba(2,27,20,.48);font-weight:900;cursor:pointer}.tgt-marker-live-back{justify-self:start}.tgt-marker-live-refresh{justify-self:end}.tgt-marker-live-toggle{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:720px;margin:20px auto 12px;padding:8px;border-radius:16px;background:#e4eade}.tgt-marker-live-toggle button{min-height:46px;border:0;border-radius:12px;color:#244539;background:transparent;font-weight:900;cursor:pointer}.tgt-marker-live-toggle button.active{color:#ffffff;background:linear-gradient(145deg,#073727,#0a4935)}.tgt-marker-live-table{width:min(960px,calc(100% - 24px));margin:0 auto;border-radius:18px;background:#fff;box-shadow:0 18px 50px rgba(18,48,36,.14)}.tgt-marker-live-table table{width:100%;border-collapse:collapse}.tgt-marker-live-table thead{color:#ffffff;background:linear-gradient(135deg,#04251b,#0a4935)}.tgt-marker-live-table th{padding:15px 12px;color:#ffffff!important;border-bottom:1px solid rgba(255,255,255,.28);font-size:11px;letter-spacing:.1em;text-transform:uppercase}.tgt-marker-live-table td{padding:15px 12px;border-bottom:1px solid #e5ebe6;background:#ffffff}.tgt-marker-live-table .player-name{color:#103d2d;font-weight:900}@media(max-width:600px){.tgt-marker-live-header{grid-template-columns:auto 1fr auto;padding:10px}.tgt-marker-live-header strong{font-size:17px}.tgt-marker-live-back,.tgt-marker-live-refresh{padding:0 10px}.tgt-marker-live-toggle{margin:12px}.tgt-marker-live-table{width:calc(100% - 12px)}.tgt-marker-live-table table{min-width:0!important}.tgt-marker-live-table th,.tgt-marker-live-table td{padding:13px 8px}.tgt-marker-live-table .player-name{font-size:14px}}
        .tgt-marker-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:22px;background:#eef5f0}.tgt-marker-kpi{min-height:118px;padding:18px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;border:1px solid rgba(22,132,84,.48);border-radius:18px;background:linear-gradient(145deg,#052a1f,#0a4935);box-shadow:0 12px 28px rgba(3,31,23,.14)}.tgt-marker-kpi span{color:#dff0e5;font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.tgt-marker-kpi strong{color:#ffffff;font-family:Georgia,serif;font-size:clamp(21px,2.2vw,27px);line-height:1.18}.tgt-marker-progress{grid-column:1/-1;min-height:100px}@media(max-width:700px){.tgt-marker-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:12px}.tgt-marker-kpi{min-height:100px;padding:14px 9px;gap:12px}.tgt-marker-kpi strong{font-size:19px}.tgt-marker-progress{grid-column:1/-1}}@media(max-width:390px){.tgt-marker-kpis{grid-template-columns:1fr}.tgt-marker-progress{grid-column:auto}}
      `}</style>
      <style>{`
        .tgt-ops-shell{min-height:100vh;padding:clamp(18px,4vw,46px) 14px;background:radial-gradient(circle at 12% 4%,rgba(22,132,84,.15),transparent 27%),radial-gradient(circle at 90% 12%,rgba(21,105,73,.20),transparent 30%),linear-gradient(155deg,#031f17 0%,#073727 48%,#0a4935 100%)}
        .tgt-ops-shell>.marker-card{width:min(1180px,100%);margin:0 auto;overflow:hidden;border:1px solid rgba(255,255,255,.42);border-radius:24px;background:#f7faf7;box-shadow:0 28px 80px rgba(0,0,0,.28)}
        .tgt-ops-shell .marker-header{align-items:center;padding:clamp(22px,4vw,36px);color:#ffffff;background:radial-gradient(circle at 92% 0%,rgba(255,255,255,.18),transparent 34%),linear-gradient(135deg,#04251b,#0a4935);border-bottom:1px solid rgba(255,255,255,.35)}
        .tgt-ops-shell .marker-header h1{margin:5px 0 7px;color:#ffffff;font-family:Georgia,serif;font-size:clamp(27px,4vw,42px);line-height:1.05}.tgt-ops-shell .marker-header .eyebrow{color:#dff0e5}.tgt-ops-shell .marker-header .description{color:rgba(255,255,255,.72)}
        .tgt-ops-shell .logout-button{min-height:44px;padding:10px 16px;border:1px solid rgba(255,255,255,.48);border-radius:999px;color:#ffffff;background:rgba(2,27,20,.52);font-weight:900}
        .tgt-ops-shell .login-submit-button{border-color:#168454;color:#ffffff;background:linear-gradient(145deg,#073727,#0a4935);box-shadow:0 8px 20px rgba(3,31,23,.15)}
        .tgt-ops-shell input,.tgt-ops-shell select,.tgt-ops-shell textarea{border-color:rgba(24,72,52,.22)!important;background:#ffffff!important}.tgt-ops-shell input:focus,.tgt-ops-shell select:focus,.tgt-ops-shell textarea:focus{outline:2px solid rgba(22,132,84,.34);border-color:#168454!important}
        @media(max-width:700px){.tgt-ops-shell{padding:8px}.tgt-ops-shell>.marker-card{border-radius:16px}.tgt-ops-shell .marker-header{align-items:flex-start;flex-direction:column;padding:22px 18px}.tgt-ops-shell .marker-header>div:last-child,.tgt-ops-shell .marker-header .logout-button{width:100%}.tgt-ops-shell .marker-header>div:last-child{display:grid!important;grid-template-columns:1fr 1fr}.tgt-ops-shell .flight-information{grid-template-columns:repeat(2,minmax(0,1fr))}.tgt-ops-shell table{min-width:620px}.tgt-ops-shell .table-wrapper{overflow-x:auto;-webkit-overflow-scrolling:touch}.tgt-ops-shell button{min-height:44px}}
      
        /* Release rule: menu-driven navigation and zero gold outside Hall of Fame */
        .tgt-individual-back-button,.tgt-team-back-button,.tgt-live-back-button,.tgt-panel-back-button{display:none!important}
        .tgt-player-shell,.tgt-public-shell,.tgt-menu-page,.tgt-ops-shell{--tgt-accent:#168454;--tgt-accent-light:#eaf5ee;--tgt-ink:#113c2d}
        .tgt-player-shell .eyebrow,.tgt-ops-shell .eyebrow,.tgt-menu-page .eyebrow{color:#168454!important}
        .tgt-player-head .eyebrow,.tgt-player-head h1,.tgt-player-head span,.tgt-marker-live-header,.marker-header h1,.marker-header .eyebrow{color:#fff!important}
        .tgt-player-avatar,.tgt-team-avatar{color:#fff!important;background:linear-gradient(145deg,#27a467,#08794c)!important;border-color:#fff!important;box-shadow:none!important}
        .tgt-player-kpi,.tgt-player-panel,.tgt-player-stat,.tgt-team-profile,.tgt-team-round,.tgt-team-final-kpi,.tgt-profile-directory-card,.tgt-directory-stat,.tgt-final-flow-card,.tgt-marker-kpi,.tgt-course-db-count,.tgt-tee-grid article{border-color:#d7e6dc!important;color:#113c2d!important;background:#fff!important;box-shadow:0 8px 22px rgba(7,63,44,.07)!important}
        .tgt-player-kpi span,.tgt-player-stat small,.tgt-team-round span,.tgt-directory-stat small,.tgt-final-flow-card span,.tgt-marker-kpi span,.tgt-course-db-count span,.tgt-tee-grid article span,.tgt-tee-grid article small{color:#688077!important}
        .tgt-player-kpi strong,.tgt-player-stat strong,.tgt-team-round strong,.tgt-team-final-kpi strong,.tgt-directory-stat strong,.tgt-final-flow-card strong,.tgt-marker-kpi strong,.tgt-course-db-count strong,.tgt-tee-grid article strong{color:#0b6543!important}
        .tgt-player-result strong,.final-score,.tgt-public-live-top-five-row>span:nth-last-child(2),.tgt-marker-top-five-row>span:nth-last-child(2){color:#0b6543!important}
        .tgt-ops-shell>.marker-card,.tgt-player-home{border-color:rgba(255,255,255,.22)!important}
        .tgt-ops-shell .marker-header,.tgt-marker-live-header,.tgt-marker-top-five-card>header,.tgt-marker-live-table thead{border-color:rgba(255,255,255,.16)!important;color:#fff!important;background:linear-gradient(135deg,#075238,#0a6845)!important}
        .tgt-ops-shell .logout-button,.tgt-marker-live-back,.tgt-marker-live-refresh{border-color:rgba(255,255,255,.34)!important;color:#fff!important;background:rgba(255,255,255,.12)!important}
        .tgt-marker-live-toggle button.active,.tgt-course-list button.active{border-color:#168454!important;color:#fff!important;background:#168454!important}
        .tgt-marker-live-table th{color:#fff!important;border-bottom-color:rgba(255,255,255,.18)!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1,.tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-premium-hero h1 span{color:#fff!important;background:none!important;-webkit-text-fill-color:#fff!important;filter:none!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-kicker{border-color:rgba(255,255,255,.38)!important;color:#fff!important}
        .tgt-public-shell:not(.tgt-hall-fullscreen) .tgt-primary-action{border-color:#fff!important;color:#fff!important;background:#168454!important}
        .tgt-fixed-bottom-nav{border-color:rgba(255,255,255,.20)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item{color:rgba(238,250,242,.72)!important}.tgt-fixed-bottom-nav .tgt-fixed-nav-item.is-active{color:#fff!important;background:rgba(255,255,255,.14)!important}.tgt-fixed-play-disc{border-color:#fff!important;color:#fff!important;background:linear-gradient(145deg,#ef5a61,#c9323a)!important}
`}</style>

      <section className="marker-card tgt-marker-dashboard-card">
        <div className="marker-header">
          <div>
            <p className="eyebrow">
              TGT markørområde
            </p>

            <h1>
              {assignment?.name ??
                "Henter bold..."}
            </h1>

            <p className="description">
              Logget ind som {session.user.email}
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {playerId && onBackToPlayer && (
              <button type="button" onClick={onBackToPlayer} className="logout-button">Menu</button>
            )}
            {assignment && availableAssignments.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setAssignment(null);
                  setSelectedRoundNumber(null);
                }}
                className="logout-button"
              >
                Skift runde
              </button>
            )}
            {assignment && (
              <button
                type="button"
                onClick={() => {
                  setMarkerLiveView(
                    assignment.rounds?.live_leaderboard_mode === "team" ? "team" : "individual"
                  );
                  setMarkerLiveOpen(true);
                }}
                className="logout-button"
              >
                Se livescore
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="logout-button"
            >
              Log ud
            </button>
          </div>
        </div>

        {assignment && assignment.rounds?.live_leaderboard_mode !== "none" && (
          <aside className="tgt-marker-top-five-wrap" aria-label="Samlet live leaderboard top 5">
            {["individual", "both"].includes(assignment.rounds.live_leaderboard_mode) && (
              <MarkerTopFiveCard title="INDIVIDUEL LIVE" entries={markerIndividualTopFive} movements={markerIndividualMovements} />
            )}
            {["team", "both"].includes(assignment.rounds.live_leaderboard_mode) && (
              <MarkerTopFiveCard title="HOLD LIVE" entries={markerTeamTopFive} movements={markerTeamMovements} />
            )}
          </aside>
        )}
        {markerLiveOpen && (
          <section className="tgt-marker-live-panel" role="dialog" aria-modal="true" aria-label="Livescore">
            <header className="tgt-marker-live-header">
              <button type="button" onClick={() => setMarkerLiveOpen(false)} className="tgt-marker-live-back">‹ Tilbage</button>
              <strong>Live score</strong>
              <button type="button" onClick={loadMarkerLiveScore} className="tgt-marker-live-refresh">Opdatér</button>
            </header>
            <div className="tgt-marker-live-scroll">
              <nav className="tgt-marker-live-toggle" aria-label="Vælg livestilling">
                <button type="button" className={markerLiveView === "individual" ? "active" : ""} onClick={() => setMarkerLiveView("individual")}>Individuel</button>
                <button type="button" className={markerLiveView === "team" ? "active" : ""} onClick={() => setMarkerLiveView("team")}>Hold</button>
              </nav>
              {markerLiveLoading && <div className="status-box">Henter livescore...</div>}
              {markerLiveError && <div className="error-box">{markerLiveError}</div>}
              {!markerLiveLoading && !markerLiveError && (
                <div className="table-wrapper tgt-marker-live-table">
                <table>
                  <thead>
                    <tr>
                      <th className="position-column">#</th>
                      <th>{markerLiveView === "individual" ? "Spiller" : "Hold"}</th>
                      <th className="number-column">Score</th>
                      <th className="number-column">Thru</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(markerLiveView === "individual" ? markerIndividualLeaderboard : markerTeamLeaderboard).map((entry, index) => {
                      const isIndividual = markerLiveView === "individual";
                      const score = isIndividual
                        ? entry.scoreToPar
                        : getTeamScoreToPar(entry);
                      const holesPlayed = isIndividual
                        ? entry.holesPlayed
                        : entry.holesPlayed ?? entry.thru ?? 0;
                      return (
                        <tr key={entry.playerId ?? entry.teamId ?? entry.id ?? index}>
                          <td className="position-column tgt-position-cell"><span className={`position-badge position-${index + 1}`}>{index + 1}</span></td>
                          <td><span className="player-name">{isIndividual ? entry.playerName : entry.teamName ?? entry.name ?? "Ukendt hold"}</span></td>
                          <td className="number-column tgt-live-to-par" style={getLeaderboardScoreStyle(holesPlayed === 0 ? 0 : score)}>{holesPlayed === 0 ? "E" : formatScore(score)}</td>
                          <td className="number-column tgt-live-thru">{holesPlayed}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {(markerLiveView === "individual" ? markerIndividualLeaderboard : markerTeamLeaderboard).length === 0 && (
                  <div className="status-box">Der er endnu ingen livescore.</div>
                )}
                </div>
              )}
            </div>
          </section>
        )}

        {loading && (
          <div className="status-box">
            Henter bold, spillere og scorekort...
          </div>
        )}

        {!loading &&
          !assignmentError &&
          selectedRoundNumber === null &&
          availableAssignments.length > 1 && (
            <section style={{ padding: 22 }}>
              <p className="eyebrow">Vælg spilledag</p>
              <h2 style={{ margin: "4px 0 8px" }}>
                Hvilken runde vil du føre score for?
              </h2>
              <p className="description">
                Det samme bold-login kan bruges på begge finaledage.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 14,
                  marginTop: 20,
                }}
              >
                {availableAssignments.map((flight) => (
                  <button
                    type="button"
                    key={flight.id}
                    onClick={() =>
                      handleSelectRound(
                        flight.rounds.round_number
                      )
                    }
                    style={{
                      padding: 20,
                      textAlign: "left",
                      border: "1px solid #d6e1d9",
                      borderRadius: 16,
                      background: "#f7faf7",
                      color: "#17271f",
                    }}
                  >
                    <span className="eyebrow">
                      {formatDate(flight.rounds.played_at)}
                    </span>
                    <strong
                      style={{
                        display: "block",
                        marginTop: 8,
                        fontSize: 20,
                      }}
                    >
                      Runde {flight.rounds.round_number} · {flight.name}
                    </strong>
                    <span
                      style={{
                        display: "block",
                        marginTop: 8,
                        color: "#68756f",
                      }}
                    >
                      Starttid {formatTime(flight.tee_time)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

        {!loading && assignmentError && (
          <div className="error-box">
            <strong>
              Bolden kunne ikke hentes
            </strong>

            <span>{assignmentError}</span>
          </div>
        )}

        {!loading &&
          !assignmentError &&
          assignment && (
            <>
              <div className="tgt-marker-kpis">
                <div className="tgt-marker-kpi"><span>Dato</span><strong>{formatDate(assignment.rounds?.played_at)}</strong></div>
                <div className="tgt-marker-kpi"><span>Runde</span><strong>{assignment.rounds?.round_number}</strong></div>
                <div className="tgt-marker-kpi"><span>Starttid</span><strong>{formatTime(assignment.tee_time)}</strong></div>
                <div className="tgt-marker-kpi"><span>Tee</span><strong>{markerTee?.tee_name ?? assignment.rounds?.tee_name ?? "Ikke valgt"}</strong></div>
                <div className="tgt-marker-kpi"><span>Samlet leaderboard</span><strong>{assignment.rounds?.live_leaderboard_mode === "individual"
                  ? "Individuel"
                  : assignment.rounds?.live_leaderboard_mode === "team"
                    ? "Hold"
                    : assignment.rounds?.live_leaderboard_mode === "both"
                      ? "Begge"
                      : "Fra"}</strong></div>
                <div className="tgt-marker-kpi tgt-marker-progress"><span>Huller gemt</span><strong>{completedHoles} / 18 huller</strong></div>
              </div>

              {assignment.rounds?.locked_at && (
                <div className="error-box" style={{ margin: "20px 20px 0" }}>
                  <strong>Runden er låst</strong>
                  <span>
                    Score og tættest på pinden kan ikke ændres. Kontakt admin,
                    hvis runden skal genåbnes.
                  </span>
                </div>
              )}

              <section
                style={{
                  marginTop: 28,
                  padding: 20,
                  border:
                    "1px solid rgba(16, 72, 51, 0.2)",
                  borderRadius: 18,
                  background: "#f7faf7",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent:
                      "space-between",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <div>
                    <p className="eyebrow">
                      Live scoreindtastning
                    </p>

                    <h2
                      style={{
                        margin: "4px 0",
                      }}
                    >
                      Hul {selectedHole}
                    </h2>

                    <p
                      style={{
                        margin: 0,
                        color: "#68756f",
                      }}
                    >
                      Par{" "}
                      {selectedHoleData?.par ??
                        "–"}
                      {" · "}
                      Index{" "}
                      {selectedHoleData
                        ?.stroke_index ?? "–"}
                    </p>
                  </div>

                  <select
                    value={selectedHole}
                    onChange={(event) => {
                      setSelectedHole(
                        Number(event.target.value)
                      );

                      setSaveMessage("");
                      setSaveError("");
                    }}
                    style={{
                      minWidth: 140,
                      padding: 12,
                      borderRadius: 10,
                      border:
                        "1px solid #cfd9d2",
                      background: "white",
                      fontWeight: 700,
                    }}
                  >
                    {holes.map((hole) => (
                      <option
                        key={hole.hole_number}
                        value={hole.hole_number}
                      >
                        Hul {hole.hole_number}
                        {" · "}
                        Par {hole.par}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    marginTop: 20,
                  }}
                >
                  {players.map((player) => {
                    const scoreKey =
                      `${player.id}-${selectedHole}`;
                    const coursePar = holes.reduce((total, hole) => total + Number(hole.par ?? 0), 0);
                    const playingHandicap = calculatePlayingHandicap(
                      player.handicap,
                      markerTee?.slope_rating,
                      markerTee?.course_rating,
                      coursePar
                    );
                    const allocatedStrokes = getAllocatedStrokes(
                      playingHandicap,
                      selectedHoleData?.stroke_index
                    );

                    return (
                      <label
                        key={player.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "48px 1fr 90px",
                          alignItems: "center",
                          gap: 12,
                          padding: 14,
                          borderRadius: 12,
                          background: "white",
                          border:
                            "1px solid #e3e9e5",
                        }}
                      >
                        <span
                          style={{
                            display: "grid",
                            placeItems: "center",
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            background: "#e8f0e9",
                            fontWeight: 800,
                          }}
                        >
                          {player.playingOrder}
                        </span>

                        <span>
                          <strong
                            style={{
                              display: "block",
                            }}
                          >
                            {player.name}
                          </strong>

                          <small
                            style={{
                              color: "#78827d",
                            }}
                          >
                            HCP {player.handicap ?? "–"}
                            {playingHandicap !== null && ` · SPH ${playingHandicap}`}
                            {` · Slag på hullet ${allocatedStrokes}`}
                          </small>
                        </span>

                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max="20"
                          value={
                            draftScores[
                              scoreKey
                            ] ?? ""
                          }
                          onChange={(event) =>
                            handleScoreChange(
                              player.id,
                              event.target.value
                            )
                          }
                          disabled={Boolean(assignment.rounds?.locked_at)}
                          placeholder="Slag"
                          style={{
                            width: "100%",
                            padding: 12,
                            borderRadius: 10,
                            border:
                              "1px solid #bdc9c1",
                            textAlign: "center",
                            fontSize: 18,
                            fontWeight: 800,
                          }}
                        />

                        <div className="tgt-net-preview">
                          <span><small>SLAG</small><strong>{"●".repeat(allocatedStrokes) || "–"}</strong></span>
                          <span><small>NETTO</small><strong>{draftScores[scoreKey] === "" || draftScores[scoreKey] === undefined ? "–" : Number(draftScores[scoreKey]) - allocatedStrokes}</strong></span>
                          <span><small>RESULTAT</small><strong>{draftScores[scoreKey] === "" || draftScores[scoreKey] === undefined ? "–" : formatScore(Number(draftScores[scoreKey]) - allocatedStrokes - Number(selectedHoleData?.par ?? 0))}</strong></span>
                        </div>

                        <button
                          type="button"
                          onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleToggleDamebajer(player); }}
                          disabled={Boolean(assignment.rounds?.locked_at) || savingDamebajerId === player.id}
                          style={{ gridColumn: "1 / -1", width: "100%", minHeight: 42, borderRadius: 10, border: "1px solid #168454", background: damebajere.some((entry) => entry.player_id === player.id && Number(entry.hole_number) === Number(selectedHole)) ? "linear-gradient(135deg, #eaf5ee, #168454)" : "#f7faf7", color: "#113c2d", fontWeight: 900, cursor: "pointer" }}
                        >
                          {savingDamebajerId === player.id ? "Gemmer..." : damebajere.some((entry) => entry.player_id === player.id && Number(entry.hole_number) === Number(selectedHole)) ? "🍺 Damebajer registreret ✓" : "🍺 Registrér damebajer"}
                        </button>
                      </label>
                    );
                  })}
                </div>

                {isClosestToPinHole && (
                  <section
                    style={{
                      marginTop: 20,
                      padding: 18,
                      borderRadius: 14,
                      border: "1px solid #d7e5da",
                      background: "#eef7f0",
                    }}
                  >
                    <p className="eyebrow">
                      Tættest på pinden
                    </p>
                    <h3 style={{ margin: "4px 0 8px" }}>
                      Boldens kandidat på hul {selectedHole}
                    </h3>
                    <p
                      style={{
                        margin: "0 0 16px",
                        color: "#68756f",
                      }}
                    >
                      Registrér kun boldens bedste spiller,
                      hvis mindst én bold ligger på green.
                    </p>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "minmax(180px, 1fr) minmax(130px, 180px)",
                        gap: 12,
                      }}
                    >
                      <select
                        value={closestPlayerId}
                        onChange={(event) => {
                          setClosestPlayerId(
                            event.target.value
                          );
                          setClosestMessage("");
                          setClosestError("");
                        }}
                        disabled={
                          closestLoading ||
                          Boolean(assignment.rounds?.locked_at)
                        }
                        style={{
                          width: "100%",
                          padding: 12,
                          borderRadius: 10,
                          border: "1px solid #bdc9c1",
                          background: "white",
                        }}
                      >
                        <option value="">
                          Vælg spiller
                        </option>
                        {players.map((player) => (
                          <option
                            key={player.id}
                            value={player.id}
                          >
                            {player.name}
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={closestDistance}
                        onChange={(event) => {
                          setClosestDistance(
                            event.target.value
                          );
                          setClosestMessage("");
                          setClosestError("");
                        }}
                        disabled={
                          closestLoading ||
                          Boolean(assignment.rounds?.locked_at)
                        }
                        placeholder="Meter, fx 1.42"
                        style={{
                          width: "100%",
                          padding: 12,
                          borderRadius: 10,
                          border: "1px solid #bdc9c1",
                          background: "white",
                        }}
                      />
                    </div>

                    {closestError && (
                      <div
                        className="error-box"
                        style={{ margin: "14px 0 0" }}
                      >
                        {closestError}
                      </div>
                    )}

                    {closestMessage && (
                      <div
                        style={{
                          marginTop: 14,
                          padding: 12,
                          borderRadius: 10,
                          background: "#e1f2e5",
                          color: "#176334",
                          fontWeight: 700,
                        }}
                      >
                        {closestMessage}
                      </div>
                    )}

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          closestEntry ? "1fr 1fr" : "1fr",
                        gap: 10,
                        marginTop: 14,
                      }}
                    >
                      <button
                        type="button"
                        onClick={handleSaveClosest}
                        disabled={
                          closestLoading ||
                          Boolean(assignment.rounds?.locked_at) ||
                          !closestPlayerId ||
                          closestDistance === ""
                        }
                        className="login-submit-button"
                        style={{ marginTop: 0 }}
                      >
                        {closestLoading
                          ? "Gemmer..."
                          : closestEntry
                            ? "Opdatér kandidat"
                            : "Gem kandidat"}
                      </button>

                      {closestEntry && (
                        <button
                          type="button"
                          onClick={handleDeleteClosest}
                          disabled={
                          closestLoading ||
                          Boolean(assignment.rounds?.locked_at)
                        }
                          className="login-cancel-button"
                          style={{ marginTop: 0 }}
                        >
                          Slet kandidat
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {saveError && (
                  <div
                    className="error-box"
                    style={{
                      marginTop: 16,
                    }}
                  >
                    {saveError}
                  </div>
                )}

                {saveMessage && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 14,
                      borderRadius: 10,
                      background: "#e7f6eb",
                      color: "#176334",
                      fontWeight: 700,
                    }}
                  >
                    {saveMessage}
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 12,
                    marginTop: 20,
                  }}
                >
                  <button
                    type="button"
                    disabled={selectedHole <= 1}
                    onClick={() =>
                      setSelectedHole(
                        (currentHole) =>
                          Math.max(
                            1,
                            currentHole - 1
                          )
                      )
                    }
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border:
                        "1px solid #cbd5ce",
                      background: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Forrige hul
                  </button>

                  <button
                    type="button"
                    disabled={
                      savingScores ||
                      Boolean(assignment.rounds?.locked_at)
                    }
                    onClick={handleSaveHole}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: 0,
                      background: "#0b4935",
                      color: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {savingScores
                      ? "Gemmer..."
                      : `Gem hul ${selectedHole}`}
                  </button>
                </div>
              </section>
            </>
          )}
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] =
    useState(null);

  const [
    checkingSession,
    setCheckingSession,
  ] = useState(true);

  const [showLogin, setShowLogin] =
    useState(null);
  const [showPublicWhileLoggedIn, setShowPublicWhileLoggedIn] = useState(false);
  const [playerScoringId, setPlayerScoringId] = useState(null);
  const [playerPortalView, setPlayerPortalView] = useState("profile");
  const [playerProfileId, setPlayerProfileId] = useState(null);
  const [playerMenuRequested, setPlayerMenuRequested] = useState(false);

  useEffect(() => {
    async function getInitialSession() {
      const { data } =
        await supabase.auth.getSession();

      setSession(data.session ?? null);
      setCheckingSession(false);
    }

    getInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        setSession(currentSession);
        setCheckingSession(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();

    setSession(null);
    setShowLogin(null);
    setShowPublicWhileLoggedIn(false);
    setPlayerScoringId(null);
    setPlayerPortalView("profile");
    setPlayerProfileId(null);
    setPlayerMenuRequested(false);
  }

  if (checkingSession) {
    return (
      <main className="login-page">
        <div className="status-box">
          Starter TGT Live...
        </div>
      </main>
    );
  }

  if (session) {
    const isAdmin =
      session.user.email?.toLowerCase() ===
      "admin@tgt.dk";

    if (isAdmin) {
      return (
        <AdminClosestToPin
          session={session}
          onLogout={handleLogout}
        />
      );
    }

    const handlePortalNavigate = (view) => {
      if (view === "play") { if (playerProfileId) setPlayerScoringId(playerProfileId); else setPlayerPortalView("profile"); return; }
      if (view === "menu") { setPlayerMenuRequested(false); setPlayerPortalView((current)=>current === "menu" ? "profile" : "menu"); return; }
      if (view === "public") { setPlayerPortalView("leaderboard"); return; }
      setPlayerMenuRequested(false); setPlayerPortalView(view);
    };
    if (playerScoringId) return <MarkerDashboard session={session} playerId={playerScoringId} onBackToPlayer={()=>{setPlayerScoringId(null);setPlayerPortalView("menu");setPlayerMenuRequested(false)}} onLogout={handleLogout}/>;
    if (playerPortalView === "menu") return <MitTgtMenuPage onNavigate={handlePortalNavigate} onLogout={handleLogout}/>;
    if (["live-leaderboard","leaderboard","team","rounds","profiles","closest","hall"].includes(playerPortalView)) return <Leaderboard key={`mit-tgt-${playerPortalView}`} initialPortalView={playerPortalView} onPortalNavigate={handlePortalNavigate} onOpenPlayerLogin={()=>handlePortalNavigate("profile")} isAuthenticated={true}/>;
    return <PlayerDashboard session={session} onLogout={handleLogout} onStartScoring={(id)=>setPlayerScoringId(id)} onNavigate={handlePortalNavigate} initialMenuOpen={playerMenuRequested} onProfileResolved={setPlayerProfileId}/>;
  }
  if (showLogin === "player") return <PlayerLogin onCancel={()=>setShowLogin(null)} onLoginSuccess={(newSession)=>{setSession(newSession);setShowLogin(null);setPlayerPortalView("profile");setPlayerScoringId(null);setPlayerMenuRequested(false)}}/>;
  return <Leaderboard onOpenPlayerLogin={()=>setShowLogin("player")}/>;
}