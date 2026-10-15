import { useEffect, useEffectEvent, useRef } from "react";
import { attachGuestHistory } from "./guestHistory.js";

export function useGuestHistory(flow, dispatch) {
  const navigation = useRef(null);
  const getFlow = useEffectEvent(() => flow);
  const navigate = useEffectEvent(screen => dispatch({ type: "NAVIGATE", screen }));
  useEffect(() => {
    const current = attachGuestHistory({ getFlow, navigate });
    navigation.current = current;
    return () => { current.dispose(); navigation.current = null; };
  }, []);
  useEffect(() => { navigation.current?.sync(flow.screen); }, [flow.screen]);
}
