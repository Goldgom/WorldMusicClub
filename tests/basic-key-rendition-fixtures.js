import {withMockBasicEligibility} from './basic-human-admission-fixtures.js';
import {readFileSync} from 'node:fs';
import {prepareCleanSong} from '../web/clean-song-package.js';

/** Original Rust five-attack source fixture with explicitly mocked new eligibility fields. */
export function basicKeyRenditionFixture(){return withMockBasicEligibility(JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-native-open.json',import.meta.url),'utf8')));}
export function basicKeySong(edit=()=>{}){const descriptor=basicKeyRenditionFixture().clean_package;edit(descriptor);return prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,JSON.parse(descriptor.score_json).notation);}
