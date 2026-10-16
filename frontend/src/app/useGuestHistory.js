import { useEffect, useEffectEvent, useRef } from "react";
import { attachGuestHistory } from "./guestHistory.js";

export function useGuestHistory(flow, dispatch, { getHomeView, restoreHomeView } = {}) {
  const navigation = useRef(null);
  const getFlow = useEffectEvent(() => flow);
  const navigate = useEffectEvent(screen => dispatch({ type: "NAVIGATE", screen }));
  const readHomeView = useEffectEvent(() => getHomeView?.());
  const restoreHome = useEffectEvent(view => restoreHomeView?.(view));
  useEffect(() => {
    const current = attachGuestHistory({ getFlow, navigate, getHomeView: readHomeView, restoreHomeView: restoreHome });
    navigation.current = current;
    return () => { current.dispose(); navigation.current = null; };
  }, []);
  useEffect(() => { navigation.current?.sync(flow.screen); }, [flow.screen]);
}
