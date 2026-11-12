import { MediaServerScrobbleService } from "../mediaserver/mediaServerScrobbleService.js";
import { TraktScrobbleService } from "./traktScrobbleService.js";
import { SimklScrobbleService } from "./simklScrobbleService.js";

import { MdbListScrobbleService } from "./mdbListScrobbleService.js";

const providers = [
  MediaServerScrobbleService,
  TraktScrobbleService,
  SimklScrobbleService,
  MdbListScrobbleService
];

let stopped = false;

function enabledProviders() {
  return providers.filter((provider) => provider.isEnabled());
}

export const TrackingScrobbleService = {
  isEnabled() {
    return enabledProviders().length > 0;
  },

  start(context) {
    stopped = false;
    enabledProviders().forEach((provider) => provider.start(context));
  },

  pause(context) {
    enabledProviders().forEach((provider) => provider.pause(context));
  },

  /** Playback is being hidden and the app may be suspended or killed. */
  suspend(context) {
    enabledProviders().forEach((provider) => provider.suspend?.(context));
  },

  stop(context, options) {
    if (stopped) return;
    stopped = true;
    enabledProviders().forEach((provider) => provider.stop(context, options));
  },

  cancel() {
    stopped = true;
    providers.forEach((provider) => provider.cancel());
  }
};
