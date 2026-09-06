/**
 * TGT nettoscore-motor
 *
 * Regler:
 * - 100 % af spillerens Playing Handicap anvendes.
 * - Handicapslag fordeles efter hullets Stroke Index.
 * - Nettoscore beregnes hul for hul.
 * - Ved Best Ball tæller holdets laveste nettoscore på hullet.
 * - Et holdhul tæller først som afsluttet, når begge holdspillere
 *   har fået registreret en score på hullet.
 */

/**
 * Sikrer, at en værdi beha*dles som et gyldigt tal.
 */
funct*on toNumber(value, fallback = 0) {*  const number = Number(value);

 *return Number.isFinite(number)
   *? number
    : fallback;
}

/**
 **Returnerer antallet af handicapsla*, som spilleren
 * modtager eller *fgiver på et bestemt hul.
 *
 * Po*itive værdier:
 * Spilleren modtag*r slag.
 *
 * Negative værdier:
 **Spilleren afgiver slag.
 *
 * Ekse*pler:
 * Playing Handicap 10:
 * 1*slag på SI 1-10.
 *
 * Playing Han*icap 20:
 * 2 slag på SI 1-2.
 * 1*slag på SI 3-18.
 *
 * Playing Han*icap -2:
 * Afgiver 1 slag på SI 1* og 18.
 */
export function getHan*icapStrokesOnHole(
  playingHandic*p,
  strokeIndex
) {
  const handi*ap = Math.trunc(
    toNumber(playingHandicap)
  );

  const index = Math.trunc(
    toNumber(strokeIndex)
  );

  if (index < 1 || index > 18) {
    throw new Error(
      `Ugyldigt Stroke Index: ${strokeIndex}`
    );
  }

  if (handicap === 0) {
    return 0;
  }

  if (handicap > 0) {
    const fullRotations = Math.floor(
      handicap / 18
    );

    const remainingStrokes =
      handicap % 18;

    return (
      fullRotations +
      (index <= remainingStrokes ? 1 : 0)
    );
  }

  /*
   * Plus-handicap:
   * Spilleren afgiver slag begyndende fra SI 18.
   *
   * Eksempel:
   * Playing Handicap -2 giver -1 slag på SI 18 og 17.
   */
  const strokesToGive * Math.abs(handicap);

  const full*otations = Math.floor(
    strokes*oGive / 18
  );

  const remaining*trokes =
    strokesToGive % 18;

* const givesExtraStroke =
    rema*ningStrokes > 0 &&
    index > 18 * remainingStrokes;

  return -(
  * fullRotations +
    (givesExtraSt*oke ? 1 : 0)
  );
}

/**
 * Beregn*r en spillers nettoscore på ét hul*
 *
 * Resultatet indeholder:
 * -*Bruttoslag
 * - Modtagne handicaps*ag
 * - Nettoslag
 * - Nettoscore * forhold til par
 */
export functi*n calculatePlayerNetHole({
  gross*trokes,
  par,
  strokeIndex,
  pl*yingHandicap,
}) {
  if (
    gros*Strokes === null ||
    grossStrok*s === undefined ||
    grossStroke* === ""
  ) {
    return null;
  }*
  const gross = toNumber(
    gro*sStrokes,
    NaN
  );

  const ho*ePar = toNumber(
    par,
    NaN
* );

  if (
    !Number.isFinite(g*oss) ||
    gross < 1
  ) {
    th*ow new Error(
      `Ugyldig brutt*score: ${grossStrokes}`
    );
  }*
  if (
    !Number.isFinite(holeP*r) ||
    holePar < 3
  ) {
    th*ow new Error(
      `Ugyldigt par:*${par}`
    );
  }

  const handic*pStrokes =
    getHandicapStrokesO*Hole(
      playingHandicap,
     *strokeIndex
    );

  const netStr*kes =
    gross - handicapStrokes;*
  const netToPar =
    netStrokes*- holePar;

  return {
    grossSt*okes: gross,
    par: holePar,
   *strokeIndex:
      toNumber(stroke*ndex),
    playingHandicap:
      *ath.trunc(
        toNumber(playin*Handicap)
      ),
    handicapStr*kes,
    netStrokes,
    netToPar,*  };
}

/**
 * Beregner en spiller* hul-for-hul nettoscores.
 *
 * ho*es:
 * [
 *   {
 *     hole_number: 1,
 *     par: 5,
 *     stroke_index: 3
 *   }
 * ]
 *
 * scores:
 * [
 *   {
 *     hole_number: 1,
 *     strokes: 6
 *   }
 * ]
 */
ex*ort function calculatePlayerNetRou*d({
  playerId,
  playerName,
  pl*yingHandicap,
  holes,
  scores,
}* {
  const scoresByHole = new Map(*    (scores ?? []).map((score) => *
      Number(score.hole_number),
*     score.strokes,
    ])
  );

 *const holeResults = (holes ?? [])
*   .map((hole) => {
      const ho*eNumber =
        Number(hole.hole*number);

      const grossStrokes*=
        scoresByHole.get(holeNum*er);

      const result =
       *calculatePlayerNetHole({
         *grossStrokes,
          par: hole.*ar,
          strokeIndex:
       *    hole.stroke_index,
          p*ayingHandicap,
        });

      *f (!result) {
        return {
   *      holeNumber,
          par: N*mber(hole.par),
          strokeIn*ex: Number(
            hole.strok*_index
          ),
          comp*eted: false,
          grossStroke*: null,
          handicapStrokes:*null,
          netStrokes: null,
*         netToPar: null,
        }*
      }

      return {
        h*leNumber,
        completed: true,*        ...result,
      };
    })*    .sort(
      (a, b) =>
       *a.holeNumber - b.holeNumber
    );*
  const completedHoles =
    hole*esults.filter(
      (hole) => hol*.completed
    );

  return {
    *layerId,
    playerName,
    playi*gHandicap:
      Math.trunc(
     *  toNumber(playingHandicap)
      *,
    holesPlayed:
      completed*oles.length,
    grossToPar:
     *completedHoles.reduce(
        (to*al, hole) =>
          total +
   *      (
            hole.grossStro*es -
            hole.par
        * ),
        0
      ),
    netToPa*:
      completedHoles.reduce(
   *    (total, hole) =>
          tot*l + hole.netToPar,
        0
     *),
    holeResults,
  };
}

/**
 **Beregner ét Best Ball-hul.
 *
 * K*n den laveste nettoscore tæller.
 *
 * Hullet betragtes som afsluttet* når alle
 * holdets spillere har *n registreret score.
 */
export fu*ction calculateBestBallHole({
  ho*e,
  players,
  scores,
}) {
  con*t holeNumber =
    Number(hole.hol*_number);

  const playerResults =*(
    players ?? []
  ).map((playe*) => {
    const playerScore = (
 *    scores ?? []
    ).find(
     *(score) =>
        score.player_id*=== player.playerId &&
        Num*er(score.hole_number) ===
          holeNumber
    );

    const netResult =
      calculatePlayerNetHole({
        grossStrokes:
          playerScore?.strokes,
        par: hole.par,
        strokeIndex:
          hole.stroke_index,
        playingHandicap:
          player.playingHandicap,
      });

    return {
      playerId: player.playerId,
      playerName: player.playerName,
      playingHandicap:
        player.playingHandicap,
      completed: Boolean(netResult),
      ...netResult,
    };
  });

  /*
   * Best Ball-hullet tæller først, når begge
   * spillere har afleveret en score.
   */
  const completed =
    playerRe*ults.length > 0 &&
    playerResul*s.every(
      (player) => player.*ompleted
    );

  if (!completed)*{
    return {
      holeNumber,
 *    par: Number(hole.par),
      s*rokeIndex: Number(
        hole.st*oke_index
      ),
      completed* false,
      teamNetToPar: null,
*     countingPlayerId: null,
     *countingPlayerName: null,
      pl*yerResults,
    };
  }

  const be*tResult = [
    ...playerResults,
  ].sort((a, b) => {
    if (a.netT*Par !== b.netToPar) {
      return*a.netToPar - b.netToPar;
    }

  * if (
      a.netStrokes !== b.net*trokes
    ) {
      return (
    *   a.netStrokes -
        b.netStr*kes
      );
    }

    return a.p*ayerName.localeCompare(
      b.pl*yerName,
      "da"
    );
  })[0]*

  return {
    holeNumber,
    p*r: Number(hole.par),
    strokeInd*x: Number(
      hole.stroke_index*    ),
    completed: true,
    te*mNetToPar:
      bestResult.netToP*r,
    countingPlayerId:
      bes*Result.playerId,
    countingPlaye*Name:
      bestResult.playerName,
    countingNetStrokes:
      bestResult.netStrokes,
    playerResults,
  };
}

/**
 * Beregner et holds samlede Best Ball-resultat.
 *
 * players skal indeholde holdets to spillere:
 *
 * [
 *   {
 *     playerId: "...",
 *     playerName: "Kasper Vang",
 *     playingHandicap: 10
 *   },
 *   {
 *     playerId: "...",
 *     playerName: "Anders Laustsen",
 *     playingHandicap: 14
 *   }
 * ]
 */
export function calculateBestBallTeam({
  teamId,
  teamName,
  players,
  holes,
  scores,
}) {
  const eligiblePlayers = (
    players ?? []
  ).filter(
    (player) =>
      player.teamCompetition !== false
  );

  if (eligiblePlayers.length !== 2) {
    return {
      teamId,
      teamName,
      players: eligiblePlayers,
      holesPlayed: 0,
      netToPar: null,
      valid: false,
      error:
        "Holdet skal have præcis to deltagende spillere.",
      holeResults: [],
    };
  }

  const holeResults = (holes ?? [])
    .map((hole) =>
      calculateBestBallHole({
        hole,
        players: eligiblePlayers,
        scores,
      })
    )
    .sort(
      (a, b) =>
        a.holeNumber - b.holeNumber
    );

  const completedHoles =
    holeResults.filter(
      (hole) => hole.completed
    );

  return {
    teamId,
    teamName,
    players: eligiblePlayers,
    holesPlayed:
      completedHoles.length,
    netToPar:
      completedHoles.reduce(
        (total, hole) =>
          total + hole.teamNetToPar,
        0
      ),
    valid: true,
    error: null,
    holeResults,
  };
}

/**
 * Beregner og sorterer hele Best Ball
 * holdleaderboardet.
 *
 * Sortering:
 * 1. Flest afsluttede holdhuller
 * 2. Laveste nettoscore
 * 3. Holdnavn
 */
export function calculateBestBallLeaderboard({
  teams,
  holes,
  scores,
}) {
  return (teams ?? [])
    .map((team) =>
      calculateBestBallTeam({
        teamId: team.teamId,
        teamName: team.teamName,
        players: team.players,
        holes,
        scores,
      })
    )
    .filter((team) => team.valid)
    .sort((a, b) => {
      if (
        a.holesPlayed !== b.holesPlayed
      ) {
        return (
          b.holesPlayed -
          a.holesPlayed
        );
      }

      if (a.netToPar !== b.netToPar) {
        return a.netToPar - b.netToPar;
      }

      return a.teamName.localeCompare(
        b.teamName,
        "da"
      );
    });
}