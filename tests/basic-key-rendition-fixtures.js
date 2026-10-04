import {readFileSync} from 'node:fs';
import {prepareCleanSong} from '../web/clean-song-package.js';

/** Original five-attack fixture emitted by the Rust native package compiler. */
export function basicKeyRenditionFixture(){return JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-native-open.json',import.meta.url),'utf8'));}
export function basicKeySong(edit=()=>{}){const descriptor=basicKeyRenditionFixture().clean_package;edit(descriptor);return prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,JSON.parse(descriptor.score_json).notation);}
