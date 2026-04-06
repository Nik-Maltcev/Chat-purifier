import { useState } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateSession } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Play } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  name: z.string().min(1, "Session name is required").max(100),
  chatList: z.string().refine((val) => {
    const lines = val.split("\n").filter(line => line.trim() !== "");
    return lines.length > 0;
  }, "Please provide at least one chat to analyze"),
  delaySeconds: z.coerce.number().min(1).max(60).default(12),
  messagesCount: z.coerce.number().min(1).max(1000).default(50),
});

type FormValues = z.infer<typeof formSchema>;

export function NewSession() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const createSessionMutation = useCreateSession();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: `Analysis Run - ${new Date().toISOString().split('T')[0]}`,
      chatList: "",
      delaySeconds: 12,
      messagesCount: 50,
    },
  });

  const onSubmit = (data: FormValues) => {
    createSessionMutation.mutate(
      { data },
      {
        onSuccess: (session) => {
          toast({
            title: "Session created",
            description: "Your session has been created successfully.",
          });
          setLocation(`/sessions/${session.id}`);
        },
        onError: (err: any) => {
          toast({
            title: "Error creating session",
            description: err?.message || "An unexpected error occurred",
            variant: "destructive",
          });
        }
      }
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Analysis Session</h1>
          <p className="text-sm text-muted-foreground">Configure a new batch run to analyze Telegram chats.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session Configuration</CardTitle>
          <CardDescription>Paste your list of chats and set analysis parameters.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Session Name</FormLabel>
                    <FormControl>
                      <Input placeholder="E.g. Relocation IT Groups pt.1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="chatList"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Chats</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Paste chat usernames or links here, one per line..." 
                        className="min-h-[200px] font-mono text-sm"
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      Provide t.me links or @usernames. One entry per line.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="delaySeconds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delay Between Requests (s)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormDescription>
                        Avoids rate limits. Default 12s.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="messagesCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Messages to Analyze</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormDescription>
                        Recent messages context per chat. Default 50.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end pt-4">
                <Button 
                  type="submit" 
                  disabled={createSessionMutation.isPending}
                  className="gap-2"
                >
                  {createSessionMutation.isPending ? (
                    <span className="w-4 h-4 rounded-full border-2 border-background border-r-transparent animate-spin inline-block" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  Create & Initialize
                </Button>
              </div>

            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
