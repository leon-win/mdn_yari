import * as React from "react";
import * as pageMetric from "./generated/page";
import * as navigatorMetric from "./generated/navigator";
import * as elementMetric from "./generated/element";
import * as pings from "./generated/pings";
import Glean from "@mozilla/glean/web";
import {
  DEV_MODE,
  GLEAN_CHANNEL,
  GLEAN_DEBUG,
  GLEAN_LOG_CLICK,
  GLEAN_ENABLED,
} from "../env";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useUserData } from "../user-context";
import { handleSidebarClick } from "./sidebar-click";
import { EXTERNAL_LINK, VIEWPORT_BREAKPOINTS } from "./constants";
import { Doc } from "../../../libs/types/document";

export type ViewportBreakpoint = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
export type HTTPStatus = "200" | "404";

const UTM_PARAMETER_NAMES = [
  "source",
  "medium",
  "campaign",
  "term",
  "content",
] as const;
type UTMParameters = Partial<
  Record<(typeof UTM_PARAMETER_NAMES)[number], string>
>;

export type PageProps = {
  referrer: string | undefined;
  path: string | undefined;
  httpStatus: HTTPStatus;
  subscriptionType: string;
  geo: string | undefined;
  geo_iso: string | undefined;
  userLanguages: string[];
  viewportBreakpoint: ViewportBreakpoint | undefined;
  isBaseline?: string;
  utm: UTMParameters;
};

export type PageEventProps = {
  referrer: string | undefined;
  path: string | undefined;
};

export type ElementClickedProps = {
  source: string;
  subscriptionType: string;
};

export type GleanAnalytics = {
  page: (arg: PageProps) => () => void;
  click: (arg: ElementClickedProps) => void;
};

const FIRST_PARTY_DATA_OPT_OUT_COOKIE_NAME = "moz-1st-party-data-opt-out";
const GLEAN_APP_ID = "mdn-yari";

function urlOrNull(url?: string, base?: string | URL) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url, base);
  } catch (_) {
    return null;
  }
}

function glean(): GleanAnalytics {
  if (typeof window === "undefined" || !GLEAN_ENABLED) {
    //SSR return noop.
    return {
      page: () => () => {},
      click: () => {},
    };
  }
  const userIsOptedOut = document.cookie
    .split("; ")
    .includes(`${FIRST_PARTY_DATA_OPT_OUT_COOKIE_NAME}=true`);

  const uploadEnabled = !userIsOptedOut && GLEAN_ENABLED;

  Glean.initialize(GLEAN_APP_ID, uploadEnabled, {
    enableAutoPageLoadEvents: true,
    channel: GLEAN_CHANNEL,
    serverEndpoint: DEV_MODE
      ? "https://developer.allizom.org"
      : document.location.origin,
  });

  if (DEV_MODE) {
    Glean.setDebugViewTag("mdn-dev");
    Glean.setLogPings(GLEAN_DEBUG);
  }

  const gleanContext = {
    page: (page: PageProps) => {
      const path = urlOrNull(page.path);
      if (path) {
        pageMetric.path.setUrl(path);
      }
      const referrer = urlOrNull(page.referrer, window?.location.href);
      if (referrer) {
        pageMetric.referrer.setUrl(referrer);
      }
      if (page.isBaseline) {
        pageMetric.isBaseline.set(page.isBaseline);
      }
      for (const param of Object.keys(page.utm) as Array<
        keyof typeof page.utm
      >) {
        const value = page.utm[param];
        if (value) {
          pageMetric.utm[param]?.set(value);
        }
      }
      pageMetric.httpStatus.set(page.httpStatus);
      if (page.geo) {
        navigatorMetric.geo.set(page.geo);
      }
      if (page.geo_iso) {
        navigatorMetric.geoIso.set(page.geo_iso);
      }
      if (page.userLanguages) {
        navigatorMetric.userLanguages.set(page.userLanguages);
      }
      if (page.viewportBreakpoint) {
        navigatorMetric.viewportBreakpoint.set(page.viewportBreakpoint);
      }
      navigatorMetric.subscriptionType.set(page.subscriptionType);
      return () => pings.page.submit();
    },
    click: (event: ElementClickedProps) => {
      const { source, subscriptionType: subscription_type } = event;
      elementMetric.clicked.record({
        source,
        subscription_type,
      });
      pings.action.submit();
    },
  };
  const gleanClick = (source: string) => {
    gleanContext.click({
      source,
      subscriptionType: "",
    });
  };
  window?.addEventListener("click", (ev) => {
    handleLinkClick(ev, gleanClick);
    handleButtonClick(ev, gleanClick);
    handleSidebarClick(ev, gleanClick);
  });

  return gleanContext;
}

const gleanAnalytics = glean();
const GleanContext = React.createContext(gleanAnalytics);

function handleButtonClick(ev: MouseEvent, click: (source: string) => void) {
  const target = ev.composedPath()?.[0] || ev.target;
  const button = (target as HTMLElement | null)?.closest("button");
  if (button instanceof HTMLButtonElement && button.dataset.glean) {
    click(button.dataset.glean);
  }
}

function handleLinkClick(ev: MouseEvent, click: (source: string) => void) {
  const target = ev.composedPath()?.[0] || ev.target;
  const anchor = (target as HTMLElement | null)?.closest("a");
  if (anchor instanceof HTMLAnchorElement) {
    if (anchor.dataset.glean) {
      click(anchor.dataset.glean);
    }
    if (
      anchor.href &&
      anchor.origin &&
      anchor.origin !== document.location.origin
    ) {
      click(`${EXTERNAL_LINK}: ${anchor.href}`);
    }
  }
}

export function GleanProvider(props: { children: React.ReactNode }) {
  return (
    <GleanContext.Provider value={gleanAnalytics}>
      {props.children}
    </GleanContext.Provider>
  );
}

export function useGlean() {
  return React.useContext(GleanContext);
}

export function useGleanPage(pageNotFound: boolean, doc?: Doc) {
  const loc = useLocation();
  const userData = useUserData();
  const path = useRef<String | null>(null);

  return useEffect(() => {
    const submit = gleanAnalytics.page({
      path: window?.location.toString(),
      referrer: document?.referrer,
      // on port 3000 this will always return "200":
      httpStatus: pageNotFound ? "404" : "200",
      userLanguages: Array.from(navigator?.languages || []),
      geo: userData?.geo?.country,
      geo_iso: userData?.geo?.country_iso,
      subscriptionType: userData?.subscriptionType || "anonymous",
      viewportBreakpoint: VIEWPORT_BREAKPOINTS.find(
        ([_, width]) => width <= window.innerWidth
      )?.[0],
      isBaseline: doc?.baseline?.baseline
        ? `baseline_${doc.baseline.baseline}`
        : doc?.baseline?.baseline === false
          ? "not_baseline"
          : undefined,
      utm: getUTMParameters(),
    });
    if (typeof userData !== "undefined" && path.current !== loc.pathname) {
      path.current = loc.pathname;
      submit();
    }
  }, [loc.pathname, userData, pageNotFound, doc?.baseline?.baseline]);
}

export function useGleanClick() {
  const userData = useUserData();
  const glean = useGlean();
  return React.useCallback(
    (source: string) => {
      if (GLEAN_LOG_CLICK && !source.includes("pong")) {
        console.log({ gleanClick: source });
      }

      glean.click({
        source,
        subscriptionType: userData?.subscriptionType || "none",
      });
    },
    [glean, userData?.subscriptionType]
  );
}

function getUTMParameters(): UTMParameters {
  const searchParams = new URLSearchParams(document.location.search);
  return UTM_PARAMETER_NAMES.reduce((acc, name): UTMParameters => {
    const param = searchParams.get(`utm_${name}`);
    return param ? { ...acc, [name]: param } : acc;
  }, {});
}
