import { afterEach, describe, expect, it, vi } from "vitest";
import { nextHeroSlide, startHeroAutoplay } from "./homepage-hero";

describe("HomepageHero autoplay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("avança a cada 3 segundos, circula e continua após navegação manual", () => {
    vi.useFakeTimers();
    let active = 0;
    const stop = startHeroAutoplay(3, false, () => {
      active = nextHeroSlide(active, 3);
    });

    vi.advanceTimersByTime(3000);
    expect(active).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(active).toBe(2);
    vi.advanceTimersByTime(3000);
    expect(active).toBe(0);

    active = nextHeroSlide(active, 3, 1);
    expect(active).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(active).toBe(2);
    expect(vi.getTimerCount()).toBe(1);

    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("não cria timer com um banner ou preferência por movimento reduzido", () => {
    vi.useFakeTimers();
    startHeroAutoplay(1, false, vi.fn());
    startHeroAutoplay(3, true, vi.fn());
    expect(vi.getTimerCount()).toBe(0);
  });
});
