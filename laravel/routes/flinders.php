<?php

use Flinders\Laravel\FlindersController as C;
use Illuminate\Support\Facades\Route;

// The contract's routes (contract/openapi.yaml): each is named flinders.<operationId>.
Route::get('/walkthroughs', [C::class, 'listWalkthroughs'])->name('flinders.listWalkthroughs');
Route::get('/progress', [C::class, 'getMyProgress'])->name('flinders.getMyProgress');
Route::patch('/offers', [C::class, 'setOffers'])->name('flinders.setOffers');
Route::post('/walkthroughs/{walkthroughId}/events', [C::class, 'recordEvent'])->name('flinders.recordEvent');
Route::post('/recording-links/check', [C::class, 'checkRecordingLink'])->name('flinders.checkRecordingLink');
Route::post('/recording-links/drafts', [C::class, 'saveRecording'])->name('flinders.saveRecording');
Route::get('/admin/walkthroughs', [C::class, 'adminList'])->name('flinders.adminList');
Route::post('/admin/walkthroughs', [C::class, 'adminUpload'])->name('flinders.adminUpload');
Route::get('/admin/walkthroughs/{walkthroughId}', [C::class, 'adminDetail'])->name('flinders.adminDetail');
Route::post('/admin/walkthroughs/{walkthroughId}/versions', [C::class, 'adminSaveVersion'])->name('flinders.adminSaveVersion');
Route::get('/admin/walkthroughs/{walkthroughId}/stats', [C::class, 'adminStats'])->name('flinders.adminStats');
Route::post('/admin/recording-links', [C::class, 'adminCreateRecordingLink'])->name('flinders.adminCreateRecordingLink');

// Anything else under the base still answers in the contract's error shape.
Route::any('/{unknown?}', [C::class, 'unknownRoute'])->where('unknown', '.*');
