
"use client";

import * as React from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Loader2 } from 'lucide-react';

const PREDEFINED_FIELDS = ["Science", "Humanities", "Engineering", "Arts", "Mathematics", "Social Sciences", "Medicine"] as const;
const CUSTOM_FIELD_VALUE = "custom_field";

const formSchema = z.object({
  selectedField: z.string().min(1, "Please select a field."),
  customField: z.string().optional(),
}).refine(data => {
  if (data.selectedField === CUSTOM_FIELD_VALUE) {
    return data.customField && data.customField.trim().length > 0;
  }
  return true;
}, {
  message: "Custom field cannot be empty when 'Other' is selected.",
  path: ["customField"], // Point error to customField input
});

type FormValues = z.infer<typeof formSchema>;

interface FieldInputFormProps {
  onSubmit: (field: string) => void;
  isLoading: boolean;
}

export function FieldInputForm({ onSubmit, isLoading }: FieldInputFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      selectedField: PREDEFINED_FIELDS[0],
      customField: "",
    },
  });

  const selectedFieldWatcher = form.watch("selectedField");

  const handleFormSubmit: SubmitHandler<FormValues> = (data) => {
    if (isLoading) return;
    const fieldToSubmit = data.selectedField === CUSTOM_FIELD_VALUE 
      ? data.customField! 
      : data.selectedField;
    onSubmit(fieldToSubmit);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Explore Subjects</CardTitle>
        <CardDescription>Choose a field of study or enter your own to generate a subject tree.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="selectedField"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Field of Study</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a field" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PREDEFINED_FIELDS.map(pf => (
                        <SelectItem key={pf} value={pf}>{pf}</SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_FIELD_VALUE}>Other (Specify below)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedFieldWatcher === CUSTOM_FIELD_VALUE && (
              <FormField
                control={form.control}
                name="customField"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Custom Field Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Quantum Mycology" {...field} />
                    </FormControl>
                    <FormDescription>
                      Enter the specific field you want to explore.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Generate Tree"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
