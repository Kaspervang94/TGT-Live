import "./App.css";
import { Fragment, useCallback, useEffect, useState } from "react";
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

function formatScore(score) {
  if (score === null || score === undefined) {
    return "Afventer";
  }

  if (score === 0) {
    return "E";
  }

  return score > 0 ? `+${score}` : String(score);
}

function getInitials(name = "") {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("") || "TGT";
}

function getScoreMarkStyle(toPar) {
  const base = { display: "inline-grid", placeItems: "center", minWidth: 30, height: 30, padding: "0 5px", fontWeight: 900, lineHeight: 1 };
  if (toPar <= -2) return { ...base, border: "3px double #18864b", borderRadius: "50%", color: "#126738", background: "#e9f8ef" };
  if (toPar === -1) return { ...base, border: "2px solid #28a45f", borderRadius: "50%", color: "#126738", background: "#effaf3" };
  if (toPar === 1) return { ...base, border: "2px solid #c98b2e", borderRadius: 3, color: "#81530f", background: "#fff7e6" };
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
                : <span style={getScoreMarkStyle(hole.toPar)}>{hole.strokes}</span>}
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
      setHoles(holesResult.data ?? []);
      setSelected((selectedResult.data ?? []).map((row) => Number(row.hole_number)));
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
      <div><strong>Tættest på pinden-huller</strong><small>Vælg kun de huller, der skal være med i konkurrencen.</small></div>
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
function Leaderboard({ onOpenLogin }) {
  const [mainTab, setMainTab] = useState("individual");
  const [tab, setTab] = useState("season");
  const [selectedSeason, setSelectedSeason] = useState(2026);
  const [availableSeasons, setAvailableSeasons] = useState([2026, 2027]);
  const [profileSearch, setProfileSearch] = useState("");
  const [directoryPlayerId, setDirectoryPlayerId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [individualFullscreen, setIndividualFullscreen] = useState(false);
  const [teamFullscreen, setTeamFullscreen] = useState(false);
  const [liveFullscreen, setLiveFullscreen] = useState(false);
  const [liveView, setLiveView] = useState("individual");
  const [panelFullscreen, setPanelFullscreen] = useState(null);
  const [standings, setStandings] = useState([]);
  const [liveData, setLiveData] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [closestEntries, setClosestEntries] = useState([]);
  const [approvedBonuses, setApprovedBonuses] = useState([]);
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
          individual_enabled,
          team_enabled,
          course_id,
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
          const bestFour = [...team.rounds]
            .sort((a, b) => a.score - b.score)
            .slice(0, 4);
          const countingScore = bestFour.reduce(
            (total, round) => total + round.score,
            0
          );
          return {
            ...team,
            roundsPlayed: team.rounds.length,
            countingScore,
            halvedScore: Math.trunc(countingScore / 2),
          };
        })
        .sort((a, b) =>
          a.halvedScore !== b.halvedScore
            ? a.halvedScore - b.halvedScore
            : a.teamName.localeCompare(b.teamName, "da")
        );
      setHistoricalTeamStandings(teamStandings);

      const [currentLiveData, currentTeamData] = await Promise.all([
        getLiveRoundLeaderboard({ season: selectedSeason }),
        getTeamLeaderboard({ season: 2026, roundNumber: 6 }),
      ]);

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
        const currentFinalStandings = await getFinalStandings({
          season: 2026,
          roundSixNumber: 6,
          roundSevenNumber: 7,
        });
        setFinalStandingsData(currentFinalStandings);
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
        loadData
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
      leaderboard: liveData?.leaderboard ?? [],
      approvedBonuses,
    })
  );
  const teamLeaderboard = teamData?.leaderboard ?? [];
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
      const roundLeaderboard = await getLiveRoundLeaderboard({
        season: selectedSeason,
        roundId: round.id,
      });
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
    setSelectedSeason(season);
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
      title: "Aktuel sæsonstilling",
      description:
        "De fire laveste rundescores tæller. Den samlede score halveres efter fire tællende runder.",
    },
    live: {
      eyebrow: "Live fra sæsonen",
      title: liveData?.round?.name ?? "Runde 6 live",
      description:
        "Bruttoscoren vises i forhold til par og opdateres automatisk, når markørerne gemmer et hul.",
    },
    team: {
      eyebrow: "Best Ball med handicap",
      title: "Holdfinale",
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
    <div className={`app tgt-public-shell${individualFullscreen ? " tgt-individual-fullscreen-open" : ""}${teamFullscreen ? " tgt-team-fullscreen-open" : ""}${liveFullscreen ? " tgt-live-fullscreen-open" : ""}${panelFullscreen ? " tgt-panel-fullscreen-open" : ""}`}>
      <style>{`
        .tgt-public-shell { background: #f3efe6; min-height: 100vh; }
        .tgt-public-topbar { position: relative; z-index: 30; display: flex; align-items: center; justify-content: space-between; padding: 14px clamp(18px, 4vw, 54px); background: rgba(7, 43, 31, .96); color: #fff; backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,.12); }
        .tgt-public-shell main { width: 100%; }
        .tgt-public-shell .leaderboard-card { width: min(1180px, calc(100% - 32px)); margin-left: auto; margin-right: auto; }
        .tgt-premium-hero { text-align: center; }
        .tgt-hero-inner { display: flex; flex-direction: column; align-items: center; }
        .tgt-premium-hero h1 { margin-left: auto; margin-right: auto; }
        .tgt-hero-meta, .tgt-hero-actions { justify-content: center; }
        .tgt-hof-grid { width: min(1040px, 100%); margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 22px; }
        .tgt-hof-card { position: relative; overflow: hidden; min-height: 430px; padding: 26px; border-radius: 24px; border: 1px solid rgba(240,207,130,.58); color: #f3d98f; background: radial-gradient(circle at 50% 0%, rgba(255,231,160,.18), transparent 26%), radial-gradient(circle at 110% 90%, rgba(199,154,66,.18), transparent 36%), linear-gradient(150deg, #031f17 0%, #073c2b 55%, #0a5039 100%); box-shadow: 0 24px 65px rgba(3,31,23,.24), inset 0 1px 0 rgba(255,241,184,.12); transition: transform .2s ease, box-shadow .2s ease; }
        .tgt-hof-card:hover { transform: translateY(-4px); box-shadow: 0 32px 78px rgba(3,31,23,.30), inset 0 1px 0 rgba(255,241,184,.16); }
        .tgt-hof-card:before { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 20%, rgba(255,238,169,.08) 43%, transparent 62%); }
        .tgt-hof-top { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 24px; }
        .tgt-hof-trophy { width: 94px; height: 94px; display: grid; place-items: center; margin-bottom: 14px; border-radius: 50%; border: 1px solid rgba(255,230,151,.76); background: radial-gradient(circle at 32% 22%, #fff0ae 0%, #d9ad51 42%, #9d691d 100%); box-shadow: 0 14px 36px rgba(211,165,73,.32), 0 0 0 8px rgba(240,207,130,.06); font-size: 48px; }
        .tgt-hof-year { margin: 0; font-family: Georgia, serif; font-size: clamp(48px, 7vw, 68px); line-height: .95; letter-spacing: -.04em; background: linear-gradient(112deg, #a97724 0%, #d7b159 25%, #fff0ad 50%, #d5a94d 75%, #f1d484 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 6px 18px rgba(0,0,0,.22)); }
        .tgt-hof-kicker { margin: 8px 0 0; color: #c9aa60; font-size: 10px; font-weight: 900; letter-spacing: .22em; text-transform: uppercase; }
        .tgt-hof-winner { position: relative; padding: 17px 18px; border-radius: 16px; border: 1px solid rgba(240,207,130,.28); background: rgba(1,24,17,.48); text-align: center; }
        .tgt-hof-winner + .tgt-hof-winner { margin-top: 12px; }
        .tgt-hof-winner span { display: block; margin-bottom: 7px; color: #c6a75d; font-size: 10px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
        .tgt-hof-winner strong { display: block; color: #f7df99; font-family: Georgia, serif; font-size: 21px; line-height: 1.2; }
        .tgt-hof-course { position: relative; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 18px; padding-top: 17px; border-top: 1px solid rgba(240,207,130,.22); color: rgba(247,223,153,.72); font-size: 13px; font-weight: 700; text-align: center; }

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
          border: 1px solid rgba(240, 207, 130, .42) !important;
          border-radius: 14px !important;
          color: #f0cf82 !important;
          box-shadow: inset 0 0 0 1px rgba(240, 207, 130, .05);
        }
        .tgt-profile-kpis > div span {
          color: #d4b45f !important;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .09em;
          text-transform: uppercase;
        }
        .tgt-profile-kpis > div strong {
          color: #f5dc93 !important;
          font-size: 24px;
          line-height: 1;
        }
        .tgt-public-shell {
          background:
            radial-gradient(circle at 12% 5%, rgba(199,154,66,.10), transparent 25%),
            linear-gradient(180deg, #ede8dc 0%, #f7f4ed 45%, #ece6d9 100%) !important;
        }
        .tgt-premium-hero {
          min-height: 430px;
          display: flex;
          align-items: center;
          background:
            radial-gradient(circle at 82% 18%, rgba(236,202,119,.25), transparent 22%),
            radial-gradient(circle at 68% 80%, rgba(23,113,77,.32), transparent 35%),
            linear-gradient(135deg, #031f17 0%, #073b2a 50%, #0b5239 100%) !important;
          border-bottom: 1px solid rgba(231,200,115,.35);
        }
        .tgt-hero-inner { position: relative; z-index: 2; width: min(1180px, 100%); }
        .tgt-hero-live {
          border: 1px solid rgba(240,207,130,.4) !important;
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
          background: #fffdf7;
          border-top: 1px solid rgba(33,72,55,.08);
          border-bottom: 1px solid rgba(33,72,55,.08);
          padding-top: 17px;
          padding-bottom: 17px;
        }
        .tgt-season-leaderboard tbody > tr:not(:has(td[colspan])) > td:first-child { border-left: 1px solid rgba(33,72,55,.08); border-radius: 14px 0 0 14px; }
        .tgt-season-leaderboard tbody > tr:not(:has(td[colspan])) > td:last-child { border-right: 1px solid rgba(33,72,55,.08); border-radius: 0 14px 14px 0; }
        .tgt-season-leaderboard tbody > tr:not(:has(td[colspan])):hover > td { background: #f5efe0; }
        .tgt-season-leaderboard .player-name { color: #103d2d; font-size: 16px; }
        .tgt-season-leaderboard .final-score { color: #a57525; font-size: 19px; }
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
          background: #fffdf7;
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
          border: 1px solid rgba(240,207,130,.44);
          border-radius: 20px;
          color: #f0cf82;
          background:
            radial-gradient(circle at 100% 0%, rgba(240,207,130,.14), transparent 34%),
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
          background: linear-gradient(135deg, #f1d686, #b9822e);
          border: 2px solid #f4d98d;
          font-family: Georgia, serif;
          font-size: 18px;
          font-weight: 900;
          box-shadow: 0 8px 24px rgba(199,154,66,.24);
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
          border: 1px solid rgba(240,207,130,.24);
        }
        .tgt-team-round span { color: #cdb46d; font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
        .tgt-team-round strong { color: #f5dc93; font-size: 22px; }
        .tgt-team-final-kpi {
          margin-top: 14px;
          padding: 15px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          border-radius: 14px;
          background: linear-gradient(135deg, rgba(199,154,66,.18), rgba(7,55,39,.72));
          border: 1px solid rgba(240,207,130,.42);
        }
        .tgt-team-final-kpi span { color: #d8bd76; font-weight: 800; }
        .tgt-team-final-kpi strong { color: #f7df99; font-size: 24px; }
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
            radial-gradient(circle at 100% 0%, rgba(240,207,130,.15), transparent 36%),
            linear-gradient(145deg, #05271d, #0a4935) !important;
          border: 1px solid rgba(240,207,130,.38) !important;
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
          border: 1px solid rgba(240,207,130,.22);
        }
        .tgt-directory-stat strong { color: #f5dc93; font-size: 18px; }
        .tgt-directory-stat small { color: #cdb46d; font-size: 9px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
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
          background: #fffdf8 !important;
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
          background: #fffdf8 !important;
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
        .tgt-final-flow-card { min-height:120px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:18px; border:1px solid rgba(240,207,130,.42); border-radius:18px; background:linear-gradient(145deg,#052a1f,#0a4935); box-shadow:0 12px 28px rgba(3,31,23,.12); text-align:center; }
        .tgt-final-flow-card span { color:#cdb46d; font-size:10px; font-weight:900; letter-spacing:.15em; text-transform:uppercase; }
        .tgt-final-flow-card strong { color:#f7df99; font-size:18px; line-height:1.35; }
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
          background: #fffdf8 !important;
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
        .tgt-wordmark-mark { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid #d7b469; border-radius: 50%; color: #f0cf82; font-family: Georgia, serif; font-size: 17px; font-weight: 900; letter-spacing: .04em; text-shadow: 0 1px 14px rgba(215,180,105,.35); }
        .tgt-menu-button { min-width: 46px; min-height: 46px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.22); border-radius: 50%; background: transparent; color: #fff; cursor: pointer; font-size: 24px; }
        .tgt-premium-hero { position: relative; overflow: hidden; padding: clamp(54px, 9vw, 110px) clamp(20px, 7vw, 92px); color: #fff; background: radial-gradient(circle at 78% 20%, rgba(215,180,105,.24), transparent 28%), linear-gradient(135deg, #062f22 0%, #0b5239 58%, #123a2d 100%); }
        .tgt-premium-hero:after { content: ""; position: absolute; right: -80px; bottom: -170px; width: 480px; height: 480px; border: 1px solid rgba(255,255,255,.1); border-radius: 50%; box-shadow: 0 0 0 55px rgba(255,255,255,.035), 0 0 0 110px rgba(255,255,255,.025); }
        .tgt-hero-inner { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; }
        .tgt-kicker { display: inline-flex; align-items: center; gap: 9px; padding: 7px 11px; border: 1px solid rgba(215,180,105,.45); border-radius: 999px; color: #f0d99e; font-size: 12px; font-weight: 800; letter-spacing: .14em; }
        .tgt-premium-hero h1 { max-width: 780px; margin: 22px 0 12px; font-family: Georgia, serif; font-size: clamp(44px, 8vw, 92px); line-height: .95; letter-spacing: -.045em; color: #e7c873; background: linear-gradient(112deg, #a97724 0%, #d7b159 24%, #fff0ad 48%, #d5a94d 72%, #f1d484 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 8px 24px rgba(0,0,0,.22)); }
        .tgt-premium-hero h1 span { display: block; color: #d7b469; -webkit-text-fill-color: #d7b469; background: none; font-size: .43em; letter-spacing: .08em; margin-top: 16px; text-transform: uppercase; }
        .tgt-hero-meta { display: flex; flex-wrap: wrap; gap: 10px 24px; margin-top: 26px; color: rgba(255,255,255,.78); font-weight: 650; }
        .tgt-hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
        .tgt-primary-action, .tgt-secondary-action { min-height: 48px; padding: 0 20px; border-radius: 999px; font-weight: 800; cursor: pointer; }
        .tgt-primary-action { border: 1px solid #d7b469; background: #d7b469; color: #082b20; }
        .tgt-secondary-action { border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.06); color: #fff; }
        .tgt-menu-backdrop { position: fixed; inset: 0; z-index: 45; background: rgba(2,20,14,.58); backdrop-filter: blur(3px); }
        .tgt-drawer { position: fixed; top: 0; right: 0; z-index: 50; width: min(390px, 92vw); height: 100dvh; padding: 22px; background: #f7f3ea; color: #10271e; box-shadow: -20px 0 60px rgba(0,0,0,.25); overflow-y: auto; }
        .tgt-drawer-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 18px; border-bottom: 1px solid #d9d3c8; }
        .tgt-drawer-close { min-width: 44px; min-height: 44px; border: 1px solid #d5cec2; border-radius: 50%; background: #fff; font-size: 22px; cursor: pointer; }
        .tgt-drawer-nav { display: grid; gap: 8px; margin-top: 20px; }
        .tgt-drawer-nav button { width: 100%; min-height: 52px; padding: 0 15px; text-align: left; border: 1px solid #dfd8cc; border-radius: 12px; background: #fff; color: #173326; font-weight: 750; cursor: pointer; }
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
          background: #f4f0e6 !important;
        }
        .tgt-admin-polish .flight-information > div {
          min-height: 104px !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 14px !important;
          padding: 16px 12px !important;
          border: 1px solid rgba(236,201,115,.44) !important;
          border-radius: 17px !important;
          text-align: center !important;
          background: linear-gradient(145deg,#052a1f,#0a4935) !important;
          box-shadow: 0 10px 24px rgba(3,31,23,.10) !important;
        }
        .tgt-admin-polish .flight-information > div > span {
          display: block !important;
          margin: 0 !important;
          color: #cdb46d !important;
          font-size: 10px !important;
          font-weight: 900 !important;
          letter-spacing: .13em !important;
          line-height: 1.2 !important;
          text-transform: uppercase !important;
        }
        .tgt-admin-polish .flight-information > div > strong {
          display: block !important;
          margin: 0 !important;
          color: #f7df99 !important;
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
          border: 1px solid rgba(236,201,115,.44) !important;
          border-radius: 18px !important;
          text-align: center !important;
          background: linear-gradient(145deg,#052a1f,#0a4935) !important;
        }
        .tgt-admin-polish .tgt-final-flow-card span {
          display: block !important;
          color: #cdb46d !important;
          font-size: 10px !important;
          font-weight: 900 !important;
          letter-spacing: .14em !important;
          text-transform: uppercase !important;
        }
        .tgt-admin-polish .tgt-final-flow-card strong {
          display: block !important;
          color: #f7df99 !important;
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

        .tgt-course-database { width:min(1120px,100%); margin:0 auto 24px; padding:clamp(18px,3vw,28px); border:1px solid rgba(25,65,48,.12); border-radius:22px; background:#fffdf8; box-shadow:0 14px 38px rgba(18,48,36,.08); }
        .tgt-course-db-header { display:flex; align-items:center; justify-content:space-between; gap:20px; text-align:left; }
        .tgt-course-db-header h2,.tgt-course-db-header p { margin-top:4px; }
        .tgt-course-db-count { min-width:110px; padding:15px; display:flex; flex-direction:column; align-items:center; gap:7px; border-radius:16px; color:#f7df99; background:linear-gradient(145deg,#052a1f,#0a4935); }
        .tgt-course-db-count span { color:#cdb46d; font-size:10px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }.tgt-course-db-count strong{font-size:26px}
        .tgt-course-db-layout { display:grid; grid-template-columns:minmax(250px,320px) minmax(0,1fr); gap:18px; margin-top:22px; }
        .tgt-course-db-sidebar,.tgt-course-db-main { min-width:0; }.tgt-course-list{display:grid;gap:8px;max-height:440px;overflow:auto;margin:12px 0 18px;padding-right:4px}
        .tgt-course-list button{display:flex;flex-direction:column;gap:4px;padding:13px;text-align:left;border:1px solid rgba(25,65,48,.12);border-radius:13px;background:#fff;color:#173326;cursor:pointer}.tgt-course-list button.active{color:#f7df99;border-color:#d8b765;background:#073727}.tgt-course-list button span{font-size:12px;opacity:.76}
        .tgt-course-form,.tgt-hole-editor,.tgt-csv-import,.tgt-course-title{padding:18px;border:1px solid rgba(25,65,48,.11);border-radius:17px;background:#f5f7f3}.tgt-course-form{display:grid;gap:10px}.tgt-course-form h3{margin:0}.tgt-tee-form{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:14px}.tgt-tee-form h3,.tgt-tee-form button{grid-column:1/-1}
        .tgt-course-title{text-align:center}.tgt-course-title h3{margin:4px 0}.tgt-tee-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.tgt-tee-grid article{display:flex;flex-direction:column;align-items:center;gap:7px;padding:16px;border:1px solid rgba(236,201,115,.44);border-radius:15px;color:#f7df99;background:linear-gradient(145deg,#052a1f,#0a4935);text-align:center}.tgt-tee-grid article span{color:#cdb46d;font-size:9px;font-weight:900;letter-spacing:.15em}.tgt-tee-grid article strong{font-size:22px}.tgt-tee-grid article small{color:rgba(247,223,153,.74)}
        .tgt-hole-editor{margin-top:14px}.tgt-hole-editor-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.tgt-hole-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:14px 0}.tgt-hole-grid label{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:10px;border-radius:12px;background:#fff;border:1px solid rgba(25,65,48,.11);text-align:center}.tgt-hole-grid label>span{grid-column:1/-1;font-weight:900;color:#174332}.tgt-hole-grid input{width:100%;min-width:0;padding:8px;border:1px solid #d8e0da;border-radius:8px;text-align:center}.tgt-hole-grid small{color:#6a7b73;font-size:9px;text-transform:uppercase}.tgt-csv-import{margin-top:14px;text-align:center}.tgt-csv-import input{display:block;margin:14px auto}.tgt-csv-import button{max-width:320px}
        @media(max-width:820px){.tgt-course-db-layout{grid-template-columns:1fr}.tgt-course-list{max-height:280px}.tgt-hole-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
        @media(max-width:520px){.tgt-course-database{padding:14px}.tgt-course-db-header{align-items:stretch;flex-direction:column;text-align:center}.tgt-course-db-count{width:100%}.tgt-tee-form{grid-template-columns:1fr}.tgt-hole-editor-head{align-items:stretch;flex-direction:column}.tgt-hole-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
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
          <button
            type="button"
            className="tgt-mobile-marker-login"
            onClick={onOpenLogin}
          >
            MARKØR-LOGIN
          </button>
          <button
            type="button"
            className="tgt-desktop-hall-button"
            onClick={() => openPanelFullscreen("hall")}
            style={{
              minHeight: 44,
              padding: "0 16px",
              border: "1px solid #d7b469",
              borderRadius: 999,
              background: "linear-gradient(135deg, #f7e4a0, #c99a42)",
              color: "#173326",
              fontWeight: 900,
              letterSpacing: ".08em",
              cursor: "pointer",
            }}
          >
            HALL OF FAME
          </button>
        <button
          type="button"
          className="tgt-menu-button"
          aria-label="Åbn hovedmenu"
          aria-expanded={menuOpen}
          aria-controls="tgt-main-menu"
          onClick={() => setMenuOpen(true)}
        >
          ☰
        </button>
        </div>
      </header>

      {menuOpen && (
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
              <button type="button" onClick={openIndividualFullscreen}>Leaderboard</button>
              <button type="button" onClick={() => openPanelFullscreen("rounds")}>Runder</button>
              <button type="button" onClick={() => openPanelFullscreen("profiles")}>Spillerprofiler</button>
              <button type="button" onClick={() => openLiveFullscreen("individual")}>Live leaderboard</button>
              <button type="button" onClick={() => openPublicView("team", "team")}>Holdturneringen</button>
              <button type="button" onClick={() => openPublicView("individual", "hall")}>Hall of Fame</button>
              <div style={{ padding: "14px 16px 6px", color: "#d7b469", fontWeight: 900, letterSpacing: ".08em" }}>VÆLG SÆSON</div>
              {[2027, 2026].map((season) => (
                <button key={season} type="button" onClick={() => switchSeason(season)} style={{ color: selectedSeason === season ? "#d7b469" : undefined, fontWeight: selectedSeason === season ? 900 : undefined }}>
                  {selectedSeason === season ? "●" : "○"} {season}
                </button>
              ))}
              <button type="button" className="tgt-menu-marker-login" onClick={() => { setMenuOpen(false); onOpenLogin(); }}>Markør- og admin-login</button>
            </nav>
          </aside>
        </>
      )}

      <section className="tgt-premium-hero">
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
              onClick={onOpenLogin}
            >
              Markør-login
            </button>
          </div>
        </div>
      </section>

      {!individualFullscreen && !teamFullscreen && !liveFullscreen && !panelFullscreen && (
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
        {individualFullscreen && (
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
        {teamFullscreen && (
          <header className="tgt-team-fullscreen-header">
            <button type="button" className="tgt-team-back-button" onClick={closeTeamFullscreen} aria-label="Tilbage til start">
              <span aria-hidden="true">‹</span>
              Tilbage
            </button>
            <strong>Holdleaderboard</strong>
            <span className="tgt-team-header-balance" aria-hidden="true" />
          </header>
        )}
        {liveFullscreen && (
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
        {panelFullscreen && (
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
              <p className="description">{currentHeading.description}</p>
            </div>
            <div className="live-badge">
              <span className="live-dot" /> LIVE
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
                style={{ width: "100%", padding: "15px 18px", borderRadius: 999, border: "1px solid rgba(169,117,37,.35)", marginBottom: 20, fontSize: 16, background: "#fffdf7", color: "#123b2c", boxShadow: "0 8px 24px rgba(24,56,43,.07)" }}
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
                      <article key={player.player_id} className="tgt-profile-directory-card" style={{ color: "#f0cf82" }}>
                        <button type="button" onClick={() => setDirectoryPlayerId(isOpen ? null : player.player_id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: 0, border: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}>
                          <span style={{ width: 58, height: 58, minWidth: 58, display: "grid", placeItems: "center", borderRadius: "50%", background: "linear-gradient(135deg, #f1d686, #b9822e)", color: "#123629", fontWeight: 900, fontSize: 20 }}>{getInitials(player.player_name)}</span>
                          <span><strong style={{ display: "block", fontSize: 17 }}>{player.player_name}</strong><small>{selectedSeason} · Placering {position}</small></span>
                        </button>
                        {isOpen && (
                          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(240,207,130,.25)" }}>
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
                  <article key={round.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", padding: 18, border: "1px solid #e1d8c8", borderRadius: 16, background: "#fffdf8" }}>
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
                  {standings.map((player, index) => {
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
                          <td className="position-column">
                            <span className={`position-badge position-${index + 1}`}>
                              {index + 1}
                            </span>
                          </td>
                          <td><span className="player-name">{player.player_name}</span></td>
                          <td className="number-column final-score">
                            {formatScore(player.counting_score)}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan="3" style={{ padding: 0 }}>
                              <div style={{ padding: 20, background: "linear-gradient(145deg, #041f17, #083e2d)", borderTop: "1px solid rgba(240,207,130,.55)", borderBottom: "1px solid rgba(240,207,130,.55)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.025)" }}>
                                <div style={{ marginBottom: 18 }}>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setProfilePlayerId(profilePlayerId === player.player_id ? null : player.player_id);
                                  }}
                                  style={{ width: "100%", minHeight: 46, marginTop: 14, border: "1px solid #c99a42", borderRadius: 12, background: "linear-gradient(145deg, #073727, #0b513a)", color: "#f0cf82", boxShadow: "inset 0 0 0 1px rgba(240,207,130,.18)", fontWeight: 900, cursor: "pointer" }}
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
                                    <div style={{ marginTop: 14, padding: 20, borderRadius: 18, background: "linear-gradient(145deg, #052a1f, #0a4633)", color: "#f0cf82", border: "1px solid rgba(240,207,130,.5)", boxShadow: "0 12px 30px rgba(1,18,13,.22)" }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
                                        <div style={{ width: 78, height: 78, minWidth: 78, display: "grid", placeItems: "center", borderRadius: "50%", border: "2px solid #e1bd66", background: "radial-gradient(circle at 30% 25%, #f5dc94, #b8802d)", color: "#133528", fontFamily: "Georgia, serif", fontSize: 27, fontWeight: 900, boxShadow: "0 8px 28px rgba(215,180,105,.3)" }}>{getInitials(player.player_name)}</div>
                                        <div><p className="eyebrow" style={{ color: "#d8bc74", marginBottom: 5 }}>The Golden Tee Tour</p><h3 style={{ margin: 0, color: "#f0d582", fontSize: 25 }}>{player.player_name}</h3><span style={{ color: "rgba(255,255,255,.7)" }}>TGT spillerprofil · 2026</span></div>
                                      </div>
                                      <div className="flight-information tgt-profile-kpis">
                                        <div><span style={{ color: "#e8cb7b" }}>Handicap</span><strong style={{ color: "#f0cf82" }}>{playerDirectory[player.player_id]?.handicap_index ?? livePlayer?.handicap ?? "–"}</strong></div>
                                        <div><span style={{ color: "#e8cb7b" }}>Placering</span><strong style={{ color: "#f0cf82" }}>{index + 1}</strong></div>
                                        <div><span style={{ color: "#e8cb7b" }}>Sæsonscore</span><strong style={{ color: "#f0cf82" }}>{formatScore(player.counting_score)}</strong></div>
                                        <div><span style={{ color: "#e8cb7b" }}>Spillede runder</span><strong style={{ color: "#f0cf82" }}>{player.rounds_played ?? playerRounds.length}</strong></div>
                                        <div><span style={{ color: "#e8cb7b" }}>Bedste runde</span><strong style={{ color: "#f0cf82" }}>{playerRounds.length ? formatScore(Math.min(...playerRounds.map((round) => round.scoreToPar))) : "–"}</strong></div>
                                        <div><span style={{ color: "#e8cb7b" }}>🍺 Damebajere</span><strong style={{ color: "#f0cf82" }}>{damebajerCounts[player.player_id] ?? 0}</strong></div>
                                      </div>
                                      <h4 style={{ margin: "20px 0 10px", color: "#f0d582" }}>Scorestatistik fra gemte scorekort</h4>
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: 9 }}>
                                        {[["Eagles+", stats.eagles, "3px double #47b979", "50%"], ["Birdies", stats.birdies, "2px solid #54c981", "50%"], ["Pars", stats.pars, "1px solid #819289", "12px"], ["Bogeys", stats.bogeys, "2px solid #d39b48", "3px"], ["Double+", stats.doublePlus, "3px double #d2675f", "3px"]].map(([label, value, border, radius]) => (
                                          <div key={label} style={{ padding: 12, textAlign: "center", border, borderRadius: radius, background: "linear-gradient(145deg, #073727, #0a4935)", boxShadow: "inset 0 0 0 1px rgba(240,207,130,.08)" }}><strong style={{ display: "block", fontSize: 22, color: "#f0cf82" }}>{value}</strong><small style={{ color: "#e8cb7b", fontWeight: 800 }}>{label}</small></div>
                                        ))}
                                      </div>
                                      {scoredHoles.length === 0 && <p style={{ marginBottom: 0, color: "rgba(255,255,255,.68)" }}>Hulstatistik udfyldes automatisk fra kommende gemte scorekort.</p>}
                                    </div>
                                  );
                                })()}
                                </div>
                                <strong style={{ display: "block", color: "#f0cf82", fontSize: 16, marginBottom: 10 }}>Tidligere runder</strong>
                                {playerRounds.length === 0 ? (
                                  <p style={{ marginBottom: 0, color: "#d4b45f" }}>
                                    Der er ingen registrerede runder for spilleren.
                                  </p>
                                ) : (
                                  <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                    {playerRounds.map((round) => {
                                      const roundKey = `${player.player_id}-${round.roundId}`;
                                      const scorecardOpen = expandedHistoricalRoundKey === roundKey;
                                      return (
                                        <div key={roundKey} style={{ borderRadius: 12, background: "#073727", border: "1px solid rgba(240,207,130,.38)", color: "#f0cf82", overflow: "hidden" }}>
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
                                              {countingRoundNumbers.has(round.roundNumber) && <small style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(240,207,130,.14)", border: "1px solid rgba(240,207,130,.5)", color: "#f0cf82", fontWeight: 900, letterSpacing: ".06em" }}>TÆLLENDE</small>}
                                              {round.hasScorecard && <small style={{ color: "#d8bd76", fontWeight: 800 }}>{scorecardOpen ? "Luk scorekort" : "Se scorekort"}</small>}
                                            </span>
                                            <strong style={{ color: "#f5dc93", fontSize: 17 }}>{formatScore(round.scoreToPar)}</strong>
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

          {!loading && !errorMessage && tab === "live" && (!liveFullscreen || liveView === "individual") && (
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
                          <small>HCP {player.handicap ?? "–"} · SPH {player.playingHandicap ?? "–"}</small>
                        </span>
                        <strong className="tgt-live-mobile-score">
                          {player.holesPlayed === 0 ? "E" : formatScore(player.scoreToPar)}
                        </strong>
                        <strong className="tgt-live-mobile-thru">{player.holesPlayed}</strong>
                      </button>
                      {isOpen && (
                        <div className="tgt-live-mobile-scorecard">
                          <SplitScorecard
                            scorecard={player.scorecard ?? []}
                            handicapIndex={player.handicapIndex ?? player.handicap}
                            playingHandicap={player.playingHandicap}
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
                          <td className="position-column">
                            <span className={`position-badge position-${index + 1}`}>{index + 1}</span>
                          </td>
                          <td>
                            <span className="player-name">{player.playerName}</span>
                            <small className="tgt-live-player-meta">HCP {player.handicap ?? "–"} · SPH {player.playingHandicap ?? "–"}</small>
                          </td>
                          <td className="number-column tgt-live-gross-score">{player.holesPlayed === 0 ? "–" : player.grossStrokes}</td>
                          <td className="number-column final-score tgt-live-to-par">{player.holesPlayed === 0 ? "E" : formatScore(player.scoreToPar)}</td>
                          <td className="number-column tgt-live-bonus">{player.earnedBonus > 0 ? player.hasCompletedRound ? `-${player.appliedBonus}` : `${player.earnedBonus} afventer` : "–"}</td>
                          <td className="number-column tgt-live-thru">{player.holesPlayed}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan="6" style={{ padding: 0 }}>
                              <div className="tgt-live-scorecard-detail">
                                <strong>{player.playerName} · scorekort efter {player.holesPlayed} huller</strong>
                                <SplitScorecard scorecard={player.scorecard ?? []} handicapIndex={player.handicapIndex ?? player.handicap} playingHandicap={player.playingHandicap} position={index + 1} />
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
          )}

          {!loading && !errorMessage && tab === "live" && liveFullscreen && liveView === "team" && (
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
                    return (
                      <Fragment key={teamKey}>
                        <tr className={isOpen ? "is-open" : ""} onClick={() => setSelectedTeamId(isOpen ? null : teamKey)} style={{ cursor: "pointer" }}>
                          <td className="position-column"><span className={`position-badge position-${index + 1}`}>{index + 1}</span></td>
                          <td><span className="player-name">{team.teamName ?? team.name ?? "Ukendt hold"}</span><small className="tgt-live-player-meta">Tryk for best ball-scorekort</small></td>
                          <td className="number-column final-score">{formatScore(team.scoreToPar ?? team.score ?? team.bestBallScore ?? 0)}</td>
                          <td className="number-column">{team.holesPlayed ?? team.thru ?? 0}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan="4" style={{ padding: 0 }}>
                              <div className="tgt-live-scorecard-detail tgt-team-best-ball-detail">
                                <strong>{team.teamName ?? team.name} · best ball efter {team.holesPlayed ?? team.thru ?? 0} huller</strong>
                                <SplitScorecard scorecard={team.scorecard ?? []} position={index + 1} />
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
                  {historicalTeamStandings.map((team, index) => {
                    const isOpen = selectedTeamId === team.teamId;
                    return (
                      <Fragment key={team.teamId}>
                        <tr
                          onClick={() =>
                            setSelectedTeamId(isOpen ? null : team.teamId)
                          }
                          style={{ cursor: "pointer" }}
                        >
                          <td className="position-column">
                            <span className={`position-badge position-${index + 1}`}>
                              {index + 1}
                            </span>
                          </td>
                          <td>
                            <span className="player-name">{team.teamName}</span>
                          </td>
                          <td className="number-column final-score">
                            {formatScore(team.halvedScore)}
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
                                    <p className="eyebrow" style={{ color: "#cdb46d", marginBottom: 5 }}>
                                      TGT holdprofil · {selectedSeason}
                                    </p>
                                    <h3 style={{ margin: 0, color: "#f5dc93", fontSize: 22 }}>
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
                        TGT-mester 2026
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
                              {player.finalCompleted
                                ? formatScore(player.finalScore)
                                : "Afventer"}
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
      <nav className="tgt-mobile-bottom-nav" aria-label="Mobilnavigation">
        <button type="button" className={tab === "season" ? "active" : ""} onClick={() => openPublicView("individual", "season")}>
          <span aria-hidden="true">◆</span><small>Leaderboard</small>
        </button>
        <button type="button" className={tab === "live" ? "active" : ""} onClick={() => openLiveFullscreen("individual")}>
          <span aria-hidden="true">●</span><small>Live</small>
        </button>
        <button type="button" className={tab === "rounds" ? "active" : ""} onClick={() => openPanelFullscreen("rounds")}>
          <span aria-hidden="true">▦</span><small>Runder</small>
        </button>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Åbn mere-menu">
          <span aria-hidden="true">☰</span><small>Mere</small>
        </button>
      </nav>
    </div>
  );
}

function MarkerLogin({
  onCancel,
  onLoginSuccess,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  async function handleLogin(event) {
    event.preventDefault();

    setLoggingIn(true);
    setLoginError("");

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

    if (error) {
      console.error("Loginfejl:", error);

      setLoginError(
        "Login mislykkedes. Kontrollér boldens mail og adgangskode."
      );

      setLoggingIn(false);
      return;
    }

    setLoggingIn(false);
    onLoginSuccess(data.session);
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-icon">⛳</div>

        <p className="eyebrow">TGT 2026</p>

        <h1>Markør- og admin-login</h1>

        <p className="description">
          Log ind med boldens login eller din administratorbruger.
        </p>

        <form onSubmit={handleLogin}>
          <label className="form-label">
            Boldens mailadresse
          </label>

          <input
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="bold1@tgt.dk"
            autoComplete="username"
            required
            className="form-input"
          />

          <label className="form-label">
            Adgangskode
          </label>

          <input
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            placeholder="Indtast adgangskode"
            autoComplete="current-password"
            required
            className="form-input"
          />

          {loginError && (
            <div className="error-box">
              {loginError}
            </div>
          )}

          <button
            type="submit"
            disabled={loggingIn}
            className="login-submit-button"
          >
            {loggingIn
              ? "Logger ind..."
              : "Log ind som markør"}
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="login-cancel-button"
          >
            Tilbage til leaderboard
          </button>
        </form>
      </section>
    </main>
  );
}

function SeasonPlayersAdmin({ season = 2027 }) {
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
      setNewPlayer({
        name: "",
        email: "",
        handicapIndex: "",
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
                        "minmax(180px, 1.3fr) minmax(180px, 1.3fr) minmax(110px, .6fr)",
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
                  "minmax(180px, 1.3fr) minmax(180px, 1.3fr) minmax(110px, .6fr)",
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

function SeasonTeamsAdmin({ season = 2027 }) {
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

function SeasonRoundsAdmin({ season = 2027 }) {
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
      setRounds(result.rounds);
      setCourses(result.courses);

      const nextDrafts = {};
      const courseIds = [
        ...new Set(result.rounds.map((round) => round.course_id).filter(Boolean)),
      ];
      const teeEntries = await Promise.all(
        courseIds.map(async (courseId) => [
          courseId,
          await getCourseTees(courseId),
        ])
      );
      const nextTeesByCourse = Object.fromEntries(teeEntries);
      setTeesByCourse(nextTeesByCourse);

      result.rounds.forEach((round) => {
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
      setMessage(`Runde ${saved.round_number} er gemt.`);
      await loadRounds();
    } catch (error) {
      console.error("Fejl ved gemning af runde:", error);
      setErrorMessage(error.message ?? "Runden kunne ikke gemmes.");
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
      setNewRound(emptyRound);
      setNewRoundTees([]);
      setMessage(`Runde ${created.round_number} er oprettet.`);
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
                    <ClosestToPinHoleSelector roundId={round.id} courseId={draft.courseId} disabled={isLocked} />
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

function RoundParticipantsAdmin({ season = 2027 }) {
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

function FlightAdmin({ season = 2027 }) {
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
                        flight.markers?.length > 0 ? "#176334" : "#8a5a16",
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

  return (
    <section className="tgt-course-database">
      <header className="tgt-course-db-header">
        <div><p className="eyebrow">Permanent TGT-register</p><h2>Banedatabase</h2><p className="description">Opret, søg og genbrug klubber, baner, tees og huldata på tværs af alle sæsoner.</p></div>
        <div className="tgt-course-db-count"><span>Baner</span><strong>{courses.length}</strong></div>
      </header>
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
  const [adminSeasonTab, setAdminSeasonTab] = useState("2026");
  const [admin2027Tab, setAdmin2027Tab] = useState("overview");

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
          locked_at,
          locked_by,
          tournaments!inner (
            season
          )
        `)
        .eq("tournaments.season", 2026)
        .in("round_number", [6, 7])
        .order("round_number", { ascending: true });

      if (roundError) throw roundError;

      const rounds = round ?? [];
      setRoundLocks(rounds);

      const roundSix = rounds.find(
        (item) => item.round_number === 6
      );

      if (!roundSix) {
        throw new Error("Runde 6 blev ikke fundet.");
      }

      setRoundId(roundSix.id);

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
        .eq("tournament_id", roundSix.tournament_id)
        .maybeSingle();

      if (archiveError) throw archiveError;
      setSeasonArchive(archive);

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
        .eq("round_id", roundSix.id)
        .eq("approved", true)
        .order("hole_number", { ascending: true });

      if (winnersError) throw winnersError;
      setApprovedWinners(winners ?? []);
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
      const preview = await getFinalFlightsPreview({
        season: 2026,
        sourceRoundNumber: 6,
        finalRoundNumber: 7,
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
    const confirmed = window.confirm(
      "Vil du oprette TGT 2027 som kladde og kopiere de aktive spillere og regler fra TGT 2026?"
    );

    if (!confirmed) return;

    setCreatingSeason2027(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "create_next_tgt_season",
        {
          source_season: 2026,
          new_season: 2027,
        }
      );

      if (error) throw error;

      setMessage(
        `TGT 2027 er oprettet som kladde. Turneringens ID er ${data}.`
      );
      await loadAdminData();
    } catch (error) {
      console.error("Fejl ved oprettelse af TGT 2027:", error);
      setErrorMessage(
        error.message ?? "TGT 2027 kunne ikke oprettes."
      );
    } finally {
      setCreatingSeason2027(false);
    }
  }

  async function handleFinalizeSeason() {
    const roundSix = roundLocks.find(
      (roundData) => roundData.round_number === 6
    );
    const roundSeven = roundLocks.find(
      (roundData) => roundData.round_number === 7
    );

    if (!roundSix?.locked_at || !roundSeven?.locked_at) {
      setErrorMessage(
        "Både Runde 6 og Runde 7 skal være låst først."
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
          roundSixNumber: 6,
          roundSevenNumber: 7,
        }),
        getTeamLeaderboard({ season: 2026, roundNumber: 6 }),
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
          requested_tournament_id: roundSix.tournament_id,
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
        .tgt-ops-shell{min-height:100vh;padding:clamp(18px,4vw,46px) 14px;background:radial-gradient(circle at 12% 4%,rgba(211,170,82,.15),transparent 27%),radial-gradient(circle at 90% 12%,rgba(21,105,73,.20),transparent 30%),linear-gradient(155deg,#031f17 0%,#073727 48%,#0a4935 100%)}
        .tgt-ops-shell>.marker-card{width:min(1180px,100%);margin:0 auto;overflow:hidden;border:1px solid rgba(240,207,130,.42);border-radius:24px;background:#f7f4ec;box-shadow:0 28px 80px rgba(0,0,0,.28)}
        .tgt-ops-shell .marker-header{align-items:center;padding:clamp(22px,4vw,36px);color:#f5dc93;background:radial-gradient(circle at 92% 0%,rgba(240,207,130,.18),transparent 34%),linear-gradient(135deg,#04251b,#0a4935);border-bottom:1px solid rgba(240,207,130,.35)}
        .tgt-ops-shell .marker-header h1{margin:5px 0 7px;color:#f5dc93;font-family:Georgia,serif;font-size:clamp(27px,4vw,42px);line-height:1.05}.tgt-ops-shell .marker-header .eyebrow{color:#c9aa60}.tgt-ops-shell .marker-header .description{color:rgba(255,241,190,.72)}
        .tgt-ops-shell .logout-button{min-height:44px;padding:10px 16px;border:1px solid rgba(240,207,130,.48);border-radius:999px;color:#f5dc93;background:rgba(2,27,20,.52);font-weight:900}
        .tgt-ops-shell .login-submit-button{border-color:#b7822e;color:#f7df99;background:linear-gradient(145deg,#073727,#0a4935);box-shadow:0 8px 20px rgba(3,31,23,.15)}
        .tgt-ops-shell input,.tgt-ops-shell select,.tgt-ops-shell textarea{border-color:rgba(24,72,52,.22)!important;background:#fffdf8!important}.tgt-ops-shell input:focus,.tgt-ops-shell select:focus,.tgt-ops-shell textarea:focus{outline:2px solid rgba(199,154,66,.34);border-color:#b7822e!important}
        @media(max-width:700px){.tgt-ops-shell{padding:8px}.tgt-ops-shell>.marker-card{border-radius:16px}.tgt-ops-shell .marker-header{align-items:flex-start;flex-direction:column;padding:22px 18px}.tgt-ops-shell .marker-header>div:last-child,.tgt-ops-shell .marker-header .logout-button{width:100%}.tgt-ops-shell .marker-header>div:last-child{display:grid!important;grid-template-columns:1fr 1fr}.tgt-ops-shell .flight-information{grid-template-columns:repeat(2,minmax(0,1fr))}.tgt-ops-shell table{min-width:620px}.tgt-ops-shell .table-wrapper{overflow-x:auto;-webkit-overflow-scrolling:touch}.tgt-ops-shell button{min-height:44px}}
      `}</style>

      <section className="marker-card">
        <div className="marker-header">
          <div>
            <p className="eyebrow">TGT administration</p>
            <h1>TGT Administration</h1>
            <p className="description">
              Administrér finalerne i 2026 og klargør hele TGT 2027 fra ét samlet overblik.
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
                ["2026", "2026 Finale"],
                ["2027", "2027 Opsætning"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setAdminSeasonTab(value)}
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

            {adminSeasonTab === "2027" && season2027 && (
              <nav
                aria-label="TGT 2027 administration"
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
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setAdmin2027Tab(value)}
                    className={
                      admin2027Tab === value
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
            {adminSeasonTab === "2026" && (
              <>
                <section
                  style={{
                    padding: 20,
                    border: "1px solid #d8e4db",
                    borderRadius: 16,
                    background: "linear-gradient(135deg, #eef7f0, #ffffff)",
                    marginBottom: 24,
                  }}
                >
                  <p className="eyebrow">Finaleafvikling 2026</p>
                  <h2 style={{ marginTop: 0 }}>Klargør og start finalerunderne</h2>
                  <p className="description">
                    Runde 6 og Runde 7 bruger nu samme sikre flow som 2027:
                    deltagere, bolde, markørlogin, publicering og livescoring.
                  </p>
                  <div className="tgt-final-flow-grid">
                    <div className="tgt-final-flow-card"><span>Runde 6</span><strong>Holdfinale og individuel runde</strong></div>
                    <div className="tgt-final-flow-card"><span>Runde 7</span><strong>Individuel finale</strong></div>
                    <div className="tgt-final-flow-card"><span>Arbejdsgang</span><strong>Draft → Ready → Live</strong></div>
                  </div>
                </section>

                <SeasonRoundsAdmin season={2026} />
                <RoundParticipantsAdmin season={2026} />
                <FlightAdmin season={2026} />

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
                          color: isLocked ? "#176334" : "#8a5a16",
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

              </>
            )}

            {adminSeasonTab === "2027" && (
              <>
                {admin2027Tab === "overview" && (
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
                {season2027 ? "TGT 2027 er oprettet" : "Opret TGT 2027"}
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
                    <strong>Kladde</strong>
                  </div>
                </div>
              ) : (
                <>
                  <p className="description">
                    Opretter TGT 2027 som en privat kladde, kopierer reglerne
                    og alle aktive spillere fra 2026. Hold, runder, datoer,
                    bolde, scores og historiske resultater kopieres ikke.
                  </p>

                  <button
                    type="button"
                    onClick={handleCreateSeason2027}
                    disabled={creatingSeason2027}
                    className="login-submit-button"
                    style={{ maxWidth: 420 }}
                  >
                    {creatingSeason2027
                      ? "Opretter TGT 2027..."
                      : "Opret TGT 2027"}
                  </button>
                </>
              )}
            </section>

                )}

                {season2027 && admin2027Tab === "players" && (
                  <SeasonPlayersAdmin season={2027} />
                )}
                {season2027 && admin2027Tab === "teams" && (
                  <SeasonTeamsAdmin season={2027} />
                )}
                {season2027 && admin2027Tab === "rounds" && (
                  <SeasonRoundsAdmin season={2027} />
                )}
                {season2027 && admin2027Tab === "participants" && (
                  <RoundParticipantsAdmin season={2027} />
                )}
                {season2027 && admin2027Tab === "flights" && (
                  <FlightAdmin season={2027} />
                )}
                {admin2027Tab === "courses" && (
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
                      Runde 6 og Runde 7 skal begge være låst først.
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

      const {
        data: markerRows,
        error: markerError,
      } = await supabase
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
              round_number,
              name,
              played_at,
              course_id,
              tee_id,
              tee_name,
              locked_at,
              locked_by
            )
          )
        `)
        .eq("user_id", session.user.id)
        .eq("active", true);

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
          "Dette login er ikke knyttet til en aktiv bold."
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
  }, [session.user.id, selectedRoundNumber]);

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
    if (!assignment) {
      return;
    }

    setSavingScores(true);
    setSaveMessage("");
    setSaveError("");

    const scoresToSave = players.map(
      (player) => ({
        playerId: player.id,

        strokes:
          draftScores[
            `${player.id}-${selectedHole}`
          ] ?? "",
      })
    );

    const missingPlayers = scoresToSave.filter(
      (score) =>
        score.strokes === "" ||
        score.strokes === null ||
        score.strokes === undefined
    );

    if (missingPlayers.length > 0) {
      setSaveError(
        "Indtast en score for alle spillere i bolden."
      );

      setSavingScores(false);
      return;
    }

    try {
      await saveHoleScores({
        roundId: assignment.round_id,
        holeNumber: selectedHole,
        scores: scoresToSave,
      });

      setSaveMessage(
        `Hul ${selectedHole} er gemt for hele bolden.`
      );

      await loadScores(
        assignment.round_id,
        players
      );

      if (
        selectedHole < 18 &&
        holes.length >= selectedHole + 1
      ) {
        setSelectedHole(
          (currentHole) => currentHole + 1
        );
      }
    } catch (error) {
      console.error(
        "Fejl ved gemning af scores:",
        error
      );

      setSaveError(
        error.message ??
          "Scorerne kunne ikke gemmes."
      );
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
        .tgt-marker-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:22px;background:#f4f0e6}.tgt-marker-kpi{min-height:118px;padding:18px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;border:1px solid rgba(236,201,115,.48);border-radius:18px;background:linear-gradient(145deg,#052a1f,#0a4935);box-shadow:0 12px 28px rgba(3,31,23,.14)}.tgt-marker-kpi span{color:#cdb46d;font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.tgt-marker-kpi strong{color:#f7df99;font-family:Georgia,serif;font-size:clamp(21px,2.2vw,27px);line-height:1.18}.tgt-marker-progress{grid-column:1/-1;min-height:100px}@media(max-width:700px){.tgt-marker-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:12px}.tgt-marker-kpi{min-height:100px;padding:14px 9px;gap:12px}.tgt-marker-kpi strong{font-size:19px}.tgt-marker-progress{grid-column:1/-1}}@media(max-width:390px){.tgt-marker-kpis{grid-template-columns:1fr}.tgt-marker-progress{grid-column:auto}}
      `}</style>
      <style>{`
        .tgt-ops-shell{min-height:100vh;padding:clamp(18px,4vw,46px) 14px;background:radial-gradient(circle at 12% 4%,rgba(211,170,82,.15),transparent 27%),radial-gradient(circle at 90% 12%,rgba(21,105,73,.20),transparent 30%),linear-gradient(155deg,#031f17 0%,#073727 48%,#0a4935 100%)}
        .tgt-ops-shell>.marker-card{width:min(1180px,100%);margin:0 auto;overflow:hidden;border:1px solid rgba(240,207,130,.42);border-radius:24px;background:#f7f4ec;box-shadow:0 28px 80px rgba(0,0,0,.28)}
        .tgt-ops-shell .marker-header{align-items:center;padding:clamp(22px,4vw,36px);color:#f5dc93;background:radial-gradient(circle at 92% 0%,rgba(240,207,130,.18),transparent 34%),linear-gradient(135deg,#04251b,#0a4935);border-bottom:1px solid rgba(240,207,130,.35)}
        .tgt-ops-shell .marker-header h1{margin:5px 0 7px;color:#f5dc93;font-family:Georgia,serif;font-size:clamp(27px,4vw,42px);line-height:1.05}.tgt-ops-shell .marker-header .eyebrow{color:#c9aa60}.tgt-ops-shell .marker-header .description{color:rgba(255,241,190,.72)}
        .tgt-ops-shell .logout-button{min-height:44px;padding:10px 16px;border:1px solid rgba(240,207,130,.48);border-radius:999px;color:#f5dc93;background:rgba(2,27,20,.52);font-weight:900}
        .tgt-ops-shell .login-submit-button{border-color:#b7822e;color:#f7df99;background:linear-gradient(145deg,#073727,#0a4935);box-shadow:0 8px 20px rgba(3,31,23,.15)}
        .tgt-ops-shell input,.tgt-ops-shell select,.tgt-ops-shell textarea{border-color:rgba(24,72,52,.22)!important;background:#fffdf8!important}.tgt-ops-shell input:focus,.tgt-ops-shell select:focus,.tgt-ops-shell textarea:focus{outline:2px solid rgba(199,154,66,.34);border-color:#b7822e!important}
        @media(max-width:700px){.tgt-ops-shell{padding:8px}.tgt-ops-shell>.marker-card{border-radius:16px}.tgt-ops-shell .marker-header{align-items:flex-start;flex-direction:column;padding:22px 18px}.tgt-ops-shell .marker-header>div:last-child,.tgt-ops-shell .marker-header .logout-button{width:100%}.tgt-ops-shell .marker-header>div:last-child{display:grid!important;grid-template-columns:1fr 1fr}.tgt-ops-shell .flight-information{grid-template-columns:repeat(2,minmax(0,1fr))}.tgt-ops-shell table{min-width:620px}.tgt-ops-shell .table-wrapper{overflow-x:auto;-webkit-overflow-scrolling:touch}.tgt-ops-shell button{min-height:44px}}
      `}</style>

      <section className="marker-card">
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
            <button
              type="button"
              onClick={onLogout}
              className="logout-button"
            >
              Log ud
            </button>
          </div>
        </div>

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
                          style={{ gridColumn: "1 / -1", width: "100%", minHeight: 42, borderRadius: 10, border: "1px solid #c99a42", background: damebajere.some((entry) => entry.player_id === player.id && Number(entry.hole_number) === Number(selectedHole)) ? "linear-gradient(135deg, #f4dfa0, #c9963d)" : "#fffaf0", color: "#3f3012", fontWeight: 900, cursor: "pointer" }}
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
    useState(false);

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
    setShowLogin(false);
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
      "kasper.vang@soderbergpartners.dk";

    if (isAdmin) {
      return (
        <AdminClosestToPin
          session={session}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <MarkerDashboard
        session={session}
        onLogout={handleLogout}
      />
    );
  }

  if (showLogin) {
    return (
      <MarkerLogin
        onCancel={() =>
          setShowLogin(false)
        }
        onLoginSuccess={(newSession) => {
          setSession(newSession);
          setShowLogin(false);
        }}
      />
    );
  }

  return (
    <Leaderboard
      onOpenLogin={() =>
        setShowLogin(true)
      }
    />
  );
}