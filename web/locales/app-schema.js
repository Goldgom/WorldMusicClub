// Explicit parameters for application display messages.
const schema = {
  "app.evidenceLimit": {
    "params": {}
  },
  "app.serverUnreadable": {
    "params": {}
  },
  "app.pause": {
    "params": {}
  },
  "app.playAgain": {
    "params": {}
  },
  "app.play": {
    "params": {}
  },
  "app.paused": {
    "params": {}
  },
  "app.loopCancelled": {
    "params": {}
  },
  "app.ready": {
    "params": {}
  },
  "app.practiceHelp": {
    "params": {}
  },
  "app.listenHelp": {
    "params": {}
  },
  "app.scoreTooLarge": {
    "params": {}
  },
  "app.preparingScore": {
    "params": {}
  },
  "app.loopCleared": {
    "params": {}
  },
  "app.previousScoreAvailable": {
    "params": {}
  },
  "app.scoreUnavailable": {
    "params": {}
  },
  "app.catalogNoMatch": {
    "params": {}
  },
  "app.catalogRetry": {
    "params": {}
  },
  "app.composerUnknown": {
    "params": {}
  },
  "app.allParts": {
    "params": {}
  },
  "app.retentionSourceEdition": {
    "params": {}
  },
  "app.retentionCounts": {
    "params": {}
  },
  "app.rightsNote": {
    "params": {}
  },
  "app.targetsPending": {
    "params": {}
  },
  "app.pianoTargets": {
    "params": {}
  },
  "app.guitarTargets": {
    "params": {}
  },
  "app.unknownKey": {
    "params": {}
  },
  "app.guitarConflict": {
    "params": {}
  },
  "app.guitarHint": {
    "params": {}
  },
  "app.practiceHint": {
    "params": {}
  },
  "app.listenHint": {
    "params": {}
  },
  "app.guitarRange": {
    "params": {}
  },
  "app.pianoRange": {
    "params": {}
  },
  "app.openString": {
    "params": {}
  },
  "app.checkingRange": {
    "params": {}
  },
  "app.mappingPending": {
    "params": {}
  },
  "app.mappingVerify": {
    "params": {}
  },
  "app.mappingLimit": {
    "params": {}
  },
  "app.mappingRetained": {
    "params": {}
  },
  "app.assessmentWaiting": {
    "params": {}
  },
  "app.clockInterruption": {
    "params": {}
  },
  "app.boundaryReview": {
    "params": {}
  },
  "app.timingRust": {
    "params": {}
  },
  "app.timingUnavailable": {
    "params": {}
  },
  "app.noSelectedTargets": {
    "params": {}
  },
  "app.tryAgain": {
    "params": {}
  },
  "app.noMatches": {
    "params": {}
  },
  "app.latestCompleted": {
    "params": {}
  },
  "app.passRetry": {
    "params": {}
  },
  "app.passPending": {
    "params": {}
  },
  "app.passBoundary": {
    "params": {}
  },
  "app.passChecked": {
    "params": {}
  },
  "app.receivingInput": {
    "params": {}
  },
  "app.checkingTake": {
    "params": {}
  },
  "app.loopInterrupted": {
    "params": {}
  },
  "app.audioLimit": {
    "params": {}
  },
  "app.complete": {
    "params": {}
  },
  "app.reducedMotion": {
    "params": {}
  },
  "app.chooseExercise": {
    "params": {}
  },
  "app.loopValidating": {
    "params": {}
  },
  "app.loopOrder": {
    "params": {}
  },
  "app.loopMinimum": {
    "params": {}
  },
  "app.loopOff": {
    "params": {}
  },
  "app.loopBoundsChanged": {
    "params": {}
  },
  "app.latencyInvalid": {
    "params": {}
  },
  "app.latencySaved": {
    "params": {}
  },
  "app.latencyUnsaved": {
    "params": {}
  },
  "app.tempoInvalid": {
    "params": {}
  },
  "app.soundOff": {
    "params": {}
  },
  "app.soundOn": {
    "params": {}
  },
  "app.fileTooLarge": {
    "params": {}
  },
  "app.jianpuTooLarge": {
    "params": {}
  },
  "app.importFailed": {
    "params": {}
  },
  "app.downloadLarge": {
    "params": {}
  },
  "app.downloadCompact": {
    "params": {}
  },
  "app.downloadComplete": {
    "params": {}
  },
  "app.blurPaused": {
    "params": {}
  },
  "app.hiddenPaused": {
    "params": {}
  },
  "app.previewStopped": {
    "params": {}
  },
  "app.chooseScore": {
    "params": {}
  },
  "app.browseScores": {
    "params": {}
  },
  "app.preparingSession": {
    "params": {}
  },
  "app.preparingPreview": {
    "params": {}
  },
  "app.previewReady": {
    "params": {}
  },
  "app.previewBrowsing": {
    "params": {}
  },
  "app.catalogLoading": {
    "params": {}
  },
  "app.catalogEmpty": {
    "params": {}
  },
  "app.catalogUnavailable": {
    "params": {}
  },
  "app.jianpuImportFailed": {
    "params": {}
  },
  "app.generatedStaff": {
    "params": {}
  },
  "app.retryNotePositions": {
    "params": {}
  },
  "app.serverStatus": {
    "params": {
      "status": "text"
    }
  },
  "app.currentSession": {
    "params": {
      "title": "text"
    }
  },
  "app.loadError": {
    "params": {
      "detail": "text"
    }
  },
  "app.catalogItem": {
    "params": {
      "count": "text",
      "bpm": "text",
      "origin": "text",
      "loading": "text"
    }
  },
  "app.loadingSuffix": {
    "params": {}
  },
  "app.scoreMeta": {
    "params": {
      "composer": "text",
      "written": "text",
      "playback": "text",
      "measures": "text",
      "parts": "text"
    }
  },
  "app.sourceDetails": {
    "params": {
      "count": "text"
    }
  },
  "app.retention": {
    "params": {
      "notes": "text",
      "rests": "text",
      "edition": "text"
    }
  },
  "app.scoreMeter": {
    "params": {
      "numerator": "text",
      "denominator": "text"
    }
  },
  "app.provenance": {
    "params": {
      "kind": "text",
      "attribution": "text",
      "license": "text"
    }
  },
  "app.license": {
    "params": {
      "license": "text"
    }
  },
  "app.practiceScope": {
    "params": {
      "name": "text",
      "targets": "text",
      "events": "text",
      "loop": "text"
    }
  },
  "app.inLoop": {
    "params": {}
  },
  "app.practiceScopePending": {
    "params": {
      "name": "text",
      "count": "text"
    }
  },
  "app.loopReady": {
    "params": {
      "start": "text",
      "end": "text",
      "count": "text",
      "crossing": "text",
      "diagnostics": "text"
    }
  },
  "app.loopCrossing": {
    "params": {
      "count": "text"
    }
  },
  "app.tonicNumbering": {
    "params": {
      "tonic": "text"
    }
  },
  "app.notationMeter": {
    "params": {
      "numerator": "text",
      "denominator": "text"
    }
  },
  "app.notationPage": {
    "params": {
      "page": "text",
      "count": "text"
    }
  },
  "app.rangeWarning": {
    "params": {
      "range": "text",
      "count": "text"
    }
  },
  "app.playNote": {
    "params": {
      "note": "text"
    }
  },
  "app.fretboardAria": {
    "params": {
      "tuning": "text",
      "capo": "text"
    }
  },
  "app.capo": {
    "params": {
      "capo": "text"
    }
  },
  "app.tuningRow": {
    "params": {
      "string": "text",
      "note": "text",
      "capo": "text"
    }
  },
  "app.capoOpen": {
    "params": {
      "note": "text"
    }
  },
  "app.fretAria": {
    "params": {
      "string": "text",
      "tuning": "text",
      "fret": "text",
      "capo": "text",
      "note": "text"
    }
  },
  "app.afterCapo": {
    "params": {
      "capo": "text"
    }
  },
  "app.guitarDescription": {
    "params": {
      "tuning": "text",
      "strings": "text",
      "frets": "text",
      "capo": "text"
    }
  },
  "app.instrumentReport": {
    "params": {
      "low": "text",
      "high": "text",
      "count": "text"
    }
  },
  "app.instrumentUnverified": {
    "params": {
      "detail": "text"
    }
  },
  "app.mappingSummary": {
    "params": {
      "count": "text"
    }
  },
  "app.mappingItem": {
    "params": {
      "note": "text",
      "seconds": "text",
      "count": "text",
      "sources": "text",
      "parts": "text"
    }
  },
  "app.unassignedInputs": {
    "params": {
      "count": "text"
    }
  },
  "app.recordedInputs": {
    "params": {
      "pass": "text",
      "count": "text"
    }
  },
  "app.delayedInput": {
    "params": {
      "pass": "text"
    }
  },
  "app.pitchSummary": {
    "params": {
      "count": "text"
    }
  },
  "app.pitchCount": {
    "params": {
      "count": "text"
    }
  },
  "app.pitchNote": {
    "params": {
      "offset": "text"
    }
  },
  "app.calibrationNote": {
    "params": {
      "summary": "text",
      "offset": "text"
    }
  },
  "app.feedbackDetail": {
    "params": {
      "tolerance": "text",
      "offset": "text"
    }
  },
  "app.passPrefix": {
    "params": {
      "pass": "text",
      "boundary": "text"
    }
  },
  "app.boundarySuffix": {
    "params": {}
  },
  "app.interruptionNote": {
    "params": {
      "interruptions": "text",
      "events": "text"
    }
  },
  "app.assessmentError": {
    "params": {
      "pass": "text",
      "detail": "text"
    }
  },
  "app.loopClockGap": {
    "params": {
      "count": "text"
    }
  },
  "app.loopIteration": {
    "params": {
      "count": "text"
    }
  },
  "app.countIn": {
    "params": {
      "count": "text"
    }
  },
  "app.yourTurn": {
    "params": {
      "loop": "text"
    }
  },
  "app.listening": {
    "params": {
      "loop": "text"
    }
  },
  "app.loopSuffix": {
    "params": {
      "count": "text"
    }
  },
  "app.writtenNotes": {
    "params": {
      "notes": "text",
      "more": "text",
      "rests": "text"
    }
  },
  "app.moreNotes": {
    "params": {
      "count": "text"
    }
  },
  "app.writtenRests": {
    "params": {
      "count": "text"
    }
  },
  "app.loopError": {
    "params": {
      "detail": "text"
    }
  },
  "app.unsupportedImport": {
    "params": {
      "detail": "text"
    }
  },
  "app.unsupportedFormat": {
    "params": {}
  },
  "app.readError": {
    "params": {
      "name": "text",
      "detail": "text"
    }
  },
  "app.exportError": {
    "params": {
      "detail": "text"
    }
  },
  "app.previewMeta": {
    "params": {
      "composer": "text",
      "origin": "text"
    }
  },
  "app.previewError": {
    "params": {
      "detail": "text"
    }
  },
  "app.previewNotices": {
    "params": {
      "count": "text"
    }
  },
  "app.moreNotices": {
    "params": {
      "count": "text"
    }
  },
  "app.previewing": {
    "params": {
      "title": "text"
    }
  },
  "app.startError": {
    "params": {
      "detail": "text"
    }
  },
  "app.catalogReady": {
    "params": {
      "count": "text"
    }
  },
  "app.catalogError": {
    "params": {
      "detail": "text"
    }
  },
  "app.compatibilityWaiting": {
    "params": {}
  },
  "app.compatibilityDirty": {
    "params": {}
  },
  "app.compatibilityPreparing": {
    "params": {}
  },
  "app.compatibilityPlanBlocked": {
    "params": {}
  },
  "app.compatibilityChecking": {
    "params": {}
  },
  "app.compatibilityPianoReady": {
    "params": {}
  },
  "app.compatibilityGuitarReady": {
    "params": {}
  },
  "app.previewDirty": {
    "params": {}
  },
  "app.previewBlocked": {
    "params": {}
  },
  "app.previewRechecking": {
    "params": {}
  },
  "app.originOriginal": {
    "params": {}
  },
  "app.originExcerpt": {
    "params": {}
  },
  "app.originCC0": {
    "params": {}
  },
  "app.originSource": {
    "params": {}
  },
  "app.originalDetail": {
    "params": {
      "detail": "text"
    }
  },
  "app.compatibilityError": {
    "params": {}
  },
  "app.profileInvalid": {
    "params": {}
  },
  "app.compatibilityBlocked": {
    "params": {}
  },
  "app.latencyPreferenceReset": {
    "params": {}
  },
  "app.takeLabel": {
    "params": {
      "number": "text"
    }
  },
  "app.loopLabel": {
    "params": {
      "number": "text"
    }
  },
  "app.instrumentReportIncomplete": {
    "params": {}
  },
  "app.instrumentReportCoverage": {
    "params": {}
  },
  "app.instrumentNoTargets": {
    "params": {}
  },
  "app.instrumentUnplayable": {
    "params": {
      "outside": "text",
      "conflict": "text"
    }
  },
  "app.instrumentOutside": {
    "params": {
      "count": "text"
    }
  },
  "app.instrumentConflict": {
    "params": {}
  },
  "app.instrumentTuningCount": {
    "params": {}
  },
  "app.instrumentTuningPitch": {
    "params": {}
  },
  "app.instrumentGuitarRange": {
    "params": {}
  },
  "app.instrumentPianoPitch": {
    "params": {}
  },
  "app.instrumentPianoRange": {
    "params": {}
  },
  "app.pitchAbsent": {
    "params": {}
  },
  "app.pitchRowsInvalid": {
    "params": {}
  },
  "app.pitchInconsistent": {
    "params": {}
  },
  "app.pitchTimingInvalid": {
    "params": {}
  },
  "app.pitchTotalsMismatch": {
    "params": {}
  },
  "app.pitchReady": {
    "params": {}
  },
  "app.pitchEmpty": {
    "params": {}
  },
  "app.pitchSampleNone": {
    "params": {}
  },
  "app.pitchSampleSmall": {
    "params": {
      "count": "text"
    }
  },
  "app.pitchSampleMatched": {
    "params": {
      "count": "text"
    }
  },
  "app.milliseconds": {
    "params": {
      "value": "text"
    }
  },
  "app.timingEarly": {
    "params": {
      "value": "text"
    }
  },
  "app.timingLate": {
    "params": {
      "value": "text"
    }
  },
  "app.adviceNoTargets": {
    "params": {}
  },
  "app.adviceMissed": {
    "params": {}
  },
  "app.adviceExtra": {
    "params": {
      "count": "text"
    }
  },
  "app.adviceBias": {
    "params": {
      "timing": "text"
    }
  },
  "app.adviceVariable": {
    "params": {}
  },
  "app.adviceSmallSample": {
    "params": {}
  },
  "app.cursorIdle": {
    "params": {}
  },
  "app.cursorLoading": {
    "params": {}
  },
  "app.cursorReady": {
    "params": {}
  },
  "app.cursorUnavailable": {
    "params": {}
  }
};
for (const value of Object.values(schema)) {Object.freeze(value.params);Object.freeze(value);}
export default Object.freeze(schema);
