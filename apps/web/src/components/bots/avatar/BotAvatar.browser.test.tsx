import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../../test/render";
import { Button } from "../../ui/button";
import { BotAvatar } from "./BotAvatar";
import "~/index.css";

it("keeps transparent overflowing avatar layers from intercepting nearby controls", async () => {
  const click = vi.fn();
  await using screen = await render(
    <div className="relative h-48 w-80">
      <span className="absolute top-0 left-0 z-10 block size-18">
        <BotAvatar seed="avatar-hit-test" size={72} />
      </span>
      <div className="absolute top-24 left-24">
        <Button onClick={click}>Nearby control</Button>
      </div>
    </div>,
  );
  const button = screen.getByRole("button", { name: "Nearby control" }).element();
  const svg = screen.container.querySelector<SVGSVGElement>("svg[data-avatar]")!;
  const box = button.getBoundingClientRect();
  const point = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2);
  const local = point.matrixTransform(svg.getScreenCTM()!.inverse());
  const layer = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  layer.setAttribute("x", String(local.x - 50));
  layer.setAttribute("y", String(local.y - 50));
  layer.setAttribute("width", "100");
  layer.setAttribute("height", "100");
  layer.setAttribute("opacity", "0");
  svg.append(layer);

  expect(document.elementFromPoint(point.x, point.y)?.closest("button")).toBe(button);
  await screen.getByRole("button", { name: "Nearby control" }).click();
  expect(click).toHaveBeenCalledOnce();
});
