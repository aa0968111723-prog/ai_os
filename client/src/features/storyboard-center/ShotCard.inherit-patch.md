Patch notes for selectable continuity aspects (to be applied to ShotCard.tsx):

1. Add import:
import {
  CONTINUITY_ASPECTS,
  ASPECT_LABEL,
  type ContinuityAspect,
} from "@shared/shotContinuity";

2. Add state:
const [inheritOpen, setInheritOpen] = useState(false);
const [inheritAspects, setInheritAspects] = useState<ContinuityAspect[]>(["characters", "looks", "location"]);

3. Replace the hard-coded ConfirmButton for inherit with the panel described in team chat.

Default aspects: characters, looks, location (camera optional).
This aligns with shared/shotContinuity.ts CONTINUITY_ASPECTS.
