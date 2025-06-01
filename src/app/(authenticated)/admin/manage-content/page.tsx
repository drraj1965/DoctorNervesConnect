
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ManageContentPage() {
  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-headline">Manage Content</CardTitle>
          <CardDescription>
            Here you can manage existing videos, articles, and other content.
            Functionality to edit and delete content will be available here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Content management features are under development.</p>
          {/* List videos, articles with edit/delete options */}
        </CardContent>
      </Card>
    </div>
  );
}
