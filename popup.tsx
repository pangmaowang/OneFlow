import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from "@/components/ui/card"
import "./style.css"

function IndexPopup() {
  const [note, setNote] = useState("")

  return (
    <div className="w-80 max-w-sm p-4">
      <Card>
        <CardHeader>
          <CardTitle>Auto Boring</CardTitle>
          <CardDescription>Quick scratch pad inside your toolbar.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-muted-foreground">Jot down a note</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="What should we automate?"
            />
          </label>
        </CardContent>

        <CardFooter className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{note || "Nothing yet"}</span>
          <Button asChild className="h-8 px-3 text-xs">
            <a
              href="https://ui.shadcn.com/docs"
              target="_blank"
              rel="noreferrer"
            >
              Learn shadcn/ui
            </a>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export default IndexPopup
